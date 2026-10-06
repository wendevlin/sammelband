import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { db } from "../src/db/client";
import { exportPath } from "../src/lib/storage-paths";
import { currentTenantId } from "../src/lib/tenant-context";
import * as albumService from "../src/services/album.service";
import * as exportService from "../src/services/export.service";
import * as imageService from "../src/services/image.service";
import * as sectionService from "../src/services/section.service";
import * as tenantService from "../src/services/tenant.service";
import { createUser, inTenant, png } from "./helpers";

async function gallery({ enabled = true } = {}) {
  if (enabled) await tenantService.updateCurrentTenant({ pdfExportEnabled: true });
  const user = await createUser();
  const album = await albumService.createAlbum({
    title: "Summer",
    description: "Two weeks in the mountains.",
    folderId: null,
    createdBy: user.id,
  });
  const section = await sectionService.createSection({ albumId: album.id });
  await sectionService.updateSection(section.id, { title: "Arrival", text: "We **left** early." });
  await imageService.uploadPhoto(png([200, 0, 0], "a.png", 60, 40), section.id, user.id);
  await imageService.uploadPhoto(png([0, 0, 200], "b.png", 30, 40), section.id, user.id);
  return { user, album, section };
}

const options = { format: "a4", quality: "screen", captions: true } as const;

async function exportRow(id: string) {
  return db.selectFrom("album_exports").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

const used = async () => (await tenantService.currentTenant()).storage_used_bytes;

describe("PDF export", () => {
  test(
    "needs the admins to switch it on",
    inTenant(async () => {
      const { user, album } = await gallery({ enabled: false });
      await expect(exportService.createExport(album.id, user.id, options)).rejects.toThrow(
        "isn't switched on",
      );
    }),
  );

  test(
    "an empty album has nothing to export",
    inTenant(async () => {
      await tenantService.updateCurrentTenant({ pdfExportEnabled: true });
      const user = await createUser();
      const album = await albumService.createAlbum({
        title: "E",
        folderId: null,
        createdBy: user.id,
      });
      await expect(exportService.createExport(album.id, user.id, options)).rejects.toThrow(
        "nothing to export",
      );
    }),
  );

  test(
    "runs in the background, stores the PDF and counts it against the quota",
    inTenant(async () => {
      const { user, album } = await gallery();
      const before = await used();
      const queued = await exportService.createExport(album.id, user.id, options);
      expect(queued).toMatchObject({ status: "queued", name: "Summer", format: "a4" });
      expect(queued.options).toEqual({ quality: "screen", captions: true });
      await exportService.exportsIdle();

      const [done] = await exportService.listExports(album.id);
      expect(done).toMatchObject({ id: queued.id, status: "done", progress: 100 });
      expect(done?.page_count).toBeGreaterThanOrEqual(4);
      expect((done?.page_count ?? 0) % 2).toBe(0);
      const row = await exportRow(queued.id);
      const path = exportPath(row.filename ?? "");
      expect(readFileSync(path).subarray(0, 5).toString()).toBe("%PDF-");
      expect(await used()).toBe(before + Number(row.file_size));

      const response = await exportService.downloadExport(queued.id);
      expect(response.headers.get("Content-Type")).toBe("application/pdf");
      expect(response.headers.get("Content-Disposition")).toContain("Summer.pdf");
    }),
  );

  test(
    "rename and delete; deleting frees the space",
    inTenant(async () => {
      const { user, album } = await gallery();
      const before = await used();
      const { id } = await exportService.createExport(album.id, user.id, options);
      await exportService.exportsIdle();
      const renamed = await exportService.renameExport(id, "  Für Oma  ");
      expect(renamed.name).toBe("Für Oma");
      const disposition = (await exportService.downloadExport(id)).headers.get(
        "Content-Disposition",
      );
      expect(disposition).toContain(`filename*=UTF-8''F%C3%BCr%20Oma.pdf`);

      const path = exportPath((await exportRow(id)).filename ?? "");
      await exportService.deleteExport(id);
      expect(existsSync(path)).toBe(false);
      expect(await used()).toBe(before);
      expect(await exportService.listExports(album.id)).toEqual([]);
      await expect(exportService.downloadExport(id)).rejects.toThrow("doesn't exist");
    }),
  );

  test(
    "deleting the album deletes its exports",
    inTenant(async () => {
      const { user, album } = await gallery();
      const before = await used();
      const { id } = await exportService.createExport(album.id, user.id, options);
      await exportService.exportsIdle();
      const path = exportPath((await exportRow(id)).filename ?? "");
      await albumService.deleteAlbum(album.id);
      expect(existsSync(path)).toBe(false);
      const rows = await db.selectFrom("album_exports").select("id").execute();
      expect(rows).toEqual([]);
      // The photos are gone too, so nothing is left counted.
      expect(await used()).toBeLessThan(before);
    }),
  );

  test(
    "a full quota makes the export fail, without a file",
    inTenant(async () => {
      const { user, album } = await gallery();
      await db
        .updateTable("tenants")
        .set((eb) => ({ quota_bytes: eb.ref("storage_used_bytes") }))
        .where("id", "=", currentTenantId())
        .execute();
      const { id } = await exportService.createExport(album.id, user.id, options);
      await exportService.exportsIdle();
      const row = await exportRow(id);
      expect(row).toMatchObject({ status: "failed", error_code: "quota_exceeded", filename: null });
      await expect(exportService.downloadExport(id)).rejects.toThrow("isn't ready");
    }),
  );

  test(
    "an export deleted while it is made leaves nothing behind",
    inTenant(async () => {
      const { user, album } = await gallery();
      const before = await used();
      const { id } = await exportService.createExport(album.id, user.id, options);
      await exportService.deleteExport(id);
      await exportService.exportsIdle();
      expect(await db.selectFrom("album_exports").select("id").execute()).toEqual([]);
      expect(await used()).toBe(before);
    }),
  );

  test(
    "unfinished exports are picked up again after a restart",
    inTenant(async () => {
      const { user, album } = await gallery();
      const { id } = await exportService.createExport(album.id, user.id, options);
      await exportService.exportsIdle();
      // As if the server had stopped while it was running.
      await db
        .updateTable("album_exports")
        .set({ status: "running", filename: null, file_size: null })
        .where("id", "=", id)
        .execute();
      await exportService.resumeExports();
      await exportService.exportsIdle();
      expect((await exportRow(id)).status).toBe("done");
    }),
  );
});
