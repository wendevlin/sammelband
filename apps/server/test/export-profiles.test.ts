import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BUILTIN_PROFILES,
  type ExportProfileSpec,
  formatProfileSpec,
  SAAL_LAYFLAT_275,
  sheetCount,
  spineWidthMm,
} from "@sammelband/shared";
import { db } from "../src/db/client";
import { exportProfileSpecSchema } from "../src/lib/export-profile-schema";
import { exportPath } from "../src/lib/storage-paths";
import * as albumService from "../src/services/album.service";
import * as exportService from "../src/services/export.service";
import * as profileService from "../src/services/export-profile.service";
import * as imageService from "../src/services/image.service";
import * as sectionService from "../src/services/section.service";
import * as tenantService from "../src/services/tenant.service";
import { createUser, inTenant, png } from "./helpers";

const mm = 72 / 25.4;

async function gallery(photos = 3) {
  await tenantService.updateCurrentTenant({ pdfExportEnabled: true });
  const user = await createUser();
  const album = await albumService.createAlbum({
    title: "Adrian",
    description: "The first year.",
    folderId: null,
    createdBy: user.id,
  });
  const section = await sectionService.createSection({ albumId: album.id });
  await sectionService.updateSection(section.id, { title: "Spring", text: "Out **at last**." });
  for (let i = 0; i < photos; i++) {
    await imageService.uploadPhoto(png([200, 40 * i, 0], `p${i}.png`, 60, 40), section.id, user.id);
  }
  return { user, album };
}

/** Every page's MediaBox and TrimBox of a PDF written by pdfkit. */
function boxes(path: string) {
  const pdf = readFileSync(path).toString("latin1");
  const nums = (m: RegExpMatchArray) => m.slice(1).map(Number);
  return {
    media: [...pdf.matchAll(/\/MediaBox \[([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)\]/g)].map(nums),
    trim: [...pdf.matchAll(/\/TrimBox \[([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)\]/g)].map(nums),
  };
}

const own: ExportProfileSpec = {
  ...formatProfileSpec("square-21", "print"),
  pageWidthMm: 200,
  pageHeightMm: 200,
  bleedMm: 5,
};

describe("print profiles", () => {
  test(
    "built-in and own profiles; only what is switched on can be used",
    inTenant(async () => {
      await tenantService.updateCurrentTenant({ pdfExportEnabled: true });
      const all = await profileService.listProfiles();
      expect(all.map((p) => p.id)).toEqual(BUILTIN_PROFILES.map((p) => p.id));
      expect(all.every((p) => p.enabled && p.builtin)).toBe(true);

      const created = await profileService.createProfile({ name: "  Square 20  ", spec: own });
      expect(created).toMatchObject({
        builtin: false,
        name: "Square 20",
        enabled: true,
        spec: own,
      });
      expect((await profileService.usableProfiles()).map((p) => p.id)).toContain(created.id);

      await profileService.setEnabled("print:a4", false);
      await profileService.setEnabled(created.id, false);
      const usable = (await profileService.usableProfiles()).map((p) => p.id);
      expect(usable).not.toContain("print:a4");
      expect(usable).not.toContain(created.id);
      await expect(profileService.usableProfile("print:a4")).rejects.toThrow("switched off");
      await expect(profileService.usableProfile(created.id)).rejects.toThrow("switched off");

      await profileService.setEnabled("print:a4", true);
      expect((await profileService.usableProfile("print:a4")).spec).toEqual(
        formatProfileSpec("a4", "print"),
      );
    }),
  );

  test(
    "a whole purpose switched off at once, own profiles included",
    inTenant(async () => {
      await tenantService.updateCurrentTenant({ pdfExportEnabled: true });
      const created = await profileService.createProfile({ name: "Own", spec: own });
      await profileService.setPurposeEnabled("print", false);
      const usable = await profileService.usableProfiles();
      expect(usable.some((p) => p.spec.purpose === "print")).toBe(false);
      expect(usable.some((p) => p.spec.purpose === "home")).toBe(true);
      await profileService.setPurposeEnabled("print", true);
      expect((await profileService.usableProfiles()).map((p) => p.id)).toContain(created.id);
    }),
  );

  test(
    "without PDF export, no profile can be used",
    inTenant(async () => {
      await tenantService.updateCurrentTenant({ pdfExportEnabled: false });
      expect(await profileService.usableProfiles()).toEqual([]);
    }),
  );

  test(
    "built-in profiles can't be changed or deleted; own ones can",
    inTenant(async () => {
      await expect(profileService.updateProfile("print:a4", { name: "x" })).rejects.toThrow(
        "can't be changed",
      );
      await expect(profileService.deleteProfile("print:a4")).rejects.toThrow("can't be changed");
      const created = await profileService.createProfile({ name: "Own", spec: own });
      const updated = await profileService.updateProfile(created.id, {
        name: "Renamed",
        spec: { ...own, dpi: 240 },
      });
      expect(updated).toMatchObject({ name: "Renamed", spec: { dpi: 240 } });
      await profileService.deleteProfile(created.id);
      await expect(profileService.usableProfile(created.id)).rejects.toThrow("doesn't exist");
    }),
  );

  test("the spec is checked: sizes, page rules, spreads in pairs", () => {
    const ok = (spec: unknown) => exportProfileSpecSchema.safeParse(spec).success;
    expect(ok(own)).toBe(true);
    expect(ok(SAAL_LAYFLAT_275)).toBe(true);
    for (const p of BUILTIN_PROFILES) expect(ok(p.spec)).toBe(true);
    expect(ok({ ...own, pageWidthMm: 10 })).toBe(false);
    expect(ok({ ...own, bleedMm: -1 })).toBe(false);
    expect(ok({ ...own, pages: { min: 40, max: 20, step: 2 } })).toBe(false);
    expect(ok({ ...SAAL_LAYFLAT_275, pages: { min: null, max: null, step: 3 } })).toBe(false);
    expect(ok({ ...own, extra: 1 })).toBe(false);
    expect(ok({ ...own, cover: { mode: "separate" } })).toBe(false);
  });

  test(
    "an export keeps its profile when the profile changes or goes",
    inTenant(async () => {
      const { user, album } = await gallery();
      const created = await profileService.createProfile({ name: "Square 20", spec: own });
      const { id } = await exportService.createExport(album.id, user.id, {
        profileId: created.id,
        captions: true,
      });
      await exportService.exportsIdle();
      await profileService.deleteProfile(created.id);
      const [done] = await exportService.listExports(album.id);
      expect(done).toMatchObject({ id, status: "done" });
      expect(done?.profile).toEqual({
        id: created.id,
        builtin: false,
        name: "Square 20",
        spec: own,
      });
      const row = await db
        .selectFrom("album_exports")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      const { media, trim } = boxes(exportPath(row.filename ?? ""));
      expect(media[0]?.[2]).toBeCloseTo(210 * mm, 1);
      expect(trim[0]?.[0]).toBeCloseTo(5 * mm, 1);
    }),
  );

  test(
    "exports with a switched-off profile are refused",
    inTenant(async () => {
      const { user, album } = await gallery();
      await profileService.setEnabled("print:a4", false);
      await expect(
        exportService.createExport(album.id, user.id, { profileId: "print:a4", captions: true }),
      ).rejects.toThrow("switched off");
      await expect(
        exportService.createExport(album.id, user.id, { profileId: "nope", captions: true }),
      ).rejects.toThrow("doesn't exist");
    }),
  );
});

describe("exports and their profile", () => {
  test(
    "a profile without a cover has no back for the album's QR code: no link is made",
    inTenant(async () => {
      const { user, album } = await gallery();
      const created = await profileService.createProfile({
        name: "No cover",
        spec: { ...own, cover: { mode: "none" } },
      });
      const queued = await exportService.createExport(album.id, user.id, {
        profileId: created.id,
        captions: true,
        albumLink: true,
      });
      expect(queued.options.album_link).toBe(false);
      await exportService.exportsIdle();
      const [done] = await exportService.listExports(album.id);
      expect(done).toMatchObject({ status: "done", album_link: null });
    }),
  );

  test(
    "an export whose profile copy no longer reads fails instead of using another profile",
    inTenant(async () => {
      const { user, album } = await gallery();
      const { id } = await exportService.createExport(album.id, user.id, {
        profileId: "print:saal-layflat-275x193",
        captions: true,
      });
      await exportService.exportsIdle();
      await db
        .updateTable("album_exports")
        .set({ status: "queued", profile: JSON.stringify({ id: "x", spec: { broken: true } }) })
        .where("id", "=", id)
        .execute();
      await exportService.resumeExports();
      await exportService.exportsIdle();
      const [failed] = await exportService.listExports(album.id);
      expect(failed).toMatchObject({ id, status: "failed", error_code: "export_failed" });
    }),
  );
});

describe("Saal Digital: spreads and a separate cover", () => {
  test(
    "one PDF page per spread, bleed only outside, and the cover as a second file",
    inTenant(async () => {
      const { user, album } = await gallery(8);
      const before = (await tenantService.currentTenant()).storage_used_bytes;
      const { id } = await exportService.createExport(album.id, user.id, {
        profileId: "print:saal-layflat-275x193",
        captions: true,
        albumLink: true,
      });
      await exportService.exportsIdle();
      const [done] = await exportService.listExports(album.id);
      expect(done).toMatchObject({ id, status: "done", has_cover_file: true });
      // At least 26 pages; eight photos can't fill them all, so blank ones, said so.
      expect(done?.page_count).toBe(26);
      expect(done?.warnings.some((w) => w.code === "blank_pages")).toBe(true);

      const row = await db
        .selectFrom("album_exports")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      const book = boxes(exportPath(row.filename ?? ""));
      // 13 spreads of (2 × 275 + 2 × 3) × (193 + 2 × 3) mm, trimmed 3 mm all round.
      expect(book.media).toHaveLength(sheetCount(SAAL_LAYFLAT_275, 26));
      expect(book.media).toHaveLength(13);
      for (const [x0, y0, w, h] of book.media) {
        expect([x0, y0]).toEqual([0, 0]);
        expect(w).toBeCloseTo((2 * 275 + 6) * mm, 1);
        expect(h).toBeCloseTo((193 + 6) * mm, 1);
      }
      for (const [l, b, r, t] of book.trim) {
        expect(l).toBeCloseTo(3 * mm, 1);
        expect(b).toBeCloseTo(3 * mm, 1);
        expect(r).toBeCloseTo((2 * 275 + 3) * mm, 1);
        expect(t).toBeCloseTo((193 + 3) * mm, 1);
      }

      const cover = boxes(exportPath(row.cover_filename ?? ""));
      expect(cover.media).toHaveLength(1);
      const spine =
        SAAL_LAYFLAT_275.cover.mode === "separate"
          ? spineWidthMm(SAAL_LAYFLAT_275.cover.spine, 26)
          : 0;
      expect(cover.media[0]?.[2]).toBeCloseTo((2 * 275 + spine + 2 * 15) * mm, 1);
      expect(cover.media[0]?.[3]).toBeCloseTo((193 + 2 * 15) * mm, 1);

      // Both files count, and go together.
      const size = readFileSync(exportPath(row.filename ?? "")).length;
      const coverSize = readFileSync(exportPath(row.cover_filename ?? "")).length;
      expect(done?.file_size).toBe(size + coverSize);
      expect((await tenantService.currentTenant()).storage_used_bytes).toBe(
        before + size + coverSize,
      );
      const download = await exportService.downloadExport(id, "cover");
      expect(download.headers.get("Content-Disposition")).toContain(
        "Adrian – Cover.pdf".replace("–", "_"),
      );
      await exportService.deleteExport(id);
      expect((await tenantService.currentTenant()).storage_used_bytes).toBe(before);
    }),
  );

  test(
    "a profile without a separate cover has no cover to download",
    inTenant(async () => {
      const { user, album } = await gallery();
      const { id } = await exportService.createExport(album.id, user.id, {
        profileId: "print:a4-landscape",
        captions: true,
      });
      await exportService.exportsIdle();
      await expect(exportService.downloadExport(id, "cover")).rejects.toThrow("doesn't exist");
    }),
  );
});
