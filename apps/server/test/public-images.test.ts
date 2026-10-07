import { describe, expect, test } from "bun:test";
import { runInTenant, tdb } from "../src/lib/tenant-context";
import * as albumService from "../src/services/album.service";
import * as folderService from "../src/services/folder.service";
import * as imageService from "../src/services/image.service";
import * as publicService from "../src/services/public.service";
import * as sectionService from "../src/services/section.service";
import * as shareService from "../src/services/share.service";
import { createTenant, createUser, png } from "./helpers";

const tokenOf = (url: string) => url.split("/s/")[1] ?? "";

/**
 * Parent/ (album "Above") → Shared/ → Sub/ (album "Middle") → Deep/ (album
 * "Deepest"), and Parent/ → Sibling/ (albums "Beside" and "Twin"). "Twin"
 * holds the same bytes as "Middle", so both use one image file.
 */
async function setup() {
  const tenant = await createTenant();
  const as = <T>(fn: () => Promise<T>) => runInTenant(tenant.id, fn);
  const data = await as(async () => {
    const user = await createUser();
    const folder = (name: string, parentId: string | null) =>
      folderService.createFolder({ name, parentId, createdBy: user.id });
    const parent = await folder("Parent", null);
    const shared = await folder("Shared", parent.id);
    const sub = await folder("Sub", shared.id);
    const deep = await folder("Deep", sub.id);
    const sibling = await folder("Sibling", parent.id);
    const album = async (title: string, folderId: string, rgb: [number, number, number]) => {
      const created = await albumService.createAlbum({ title, folderId, createdBy: user.id });
      const section = await sectionService.createSection({ albumId: created.id });
      const upload = await imageService.uploadPhoto(png(rgb), section.id, user.id);
      return { album: created, filename: upload.imageFile.filename, upload };
    };
    return {
      user,
      parent,
      shared,
      sibling,
      above: await album("Above", parent.id, [0, 0, 255]),
      middle: await album("Middle", sub.id, [9, 9, 9]),
      deepest: await album("Deepest", deep.id, [255, 0, 0]),
      beside: await album("Beside", sibling.id, [0, 255, 0]),
      twin: await album("Twin", sibling.id, [9, 9, 9]),
    };
  });
  const link = async (target: shareService.ShareTarget) => {
    const share = await as(() => shareService.createShare(target, {}, data.user.id));
    return publicService.access(tokenOf(share.url), () => undefined);
  };
  return { as, link, ...data };
}

describe("public link images", () => {
  test("a folder link serves images from any depth of its subtree, nothing beside or above", async () => {
    const { link, shared, above, middle, deepest, beside, twin } = await setup();
    expect(twin.upload.deduplicated).toBe(true);
    expect(twin.filename).toBe(middle.filename);

    const access = await link({ folderId: shared.id });
    expect((await publicService.image(access, deepest.filename, 400, "webp")).status).toBe(200);
    // Also in "Twin" outside the link, but in "Middle" inside it.
    expect((await publicService.image(access, middle.filename, 400, "webp")).status).toBe(200);
    for (const outside of [beside, above]) {
      await expect(publicService.image(access, outside.filename, 400, "webp")).rejects.toThrow(
        "not found",
      );
    }
    await expect(publicService.image(access, "nope", 400, "webp")).rejects.toThrow("not found");
  });

  test("an album link serves a shared file through that album only", async () => {
    const { link, twin, beside, deepest } = await setup();
    const access = await link({ albumId: twin.album.id });
    expect((await publicService.image(access, twin.filename, 800, "jpeg")).status).toBe(200);
    for (const outside of [beside, deepest]) {
      await expect(publicService.image(access, outside.filename, 400, "webp")).rejects.toThrow(
        "not found",
      );
    }
  });

  test("a folder loop in the data refuses instead of hanging", async () => {
    const { as, link, user, shared } = await setup();
    const loop = await as(async () => {
      const a = await folderService.createFolder({ name: "A", parentId: null, createdBy: user.id });
      const b = await folderService.createFolder({ name: "B", parentId: a.id, createdBy: user.id });
      // Not possible through the services, only by writing the rows directly.
      await tdb().updateTable("folders").set({ parent_id: b.id }).where("id", "=", a.id).execute();
      const album = await albumService.createAlbum({
        title: "Loop",
        folderId: a.id,
        createdBy: user.id,
      });
      const section = await sectionService.createSection({ albumId: album.id });
      const upload = await imageService.uploadPhoto(png([1, 2, 3]), section.id, user.id);
      return { folder: a, filename: upload.imageFile.filename };
    });
    const access = await link({ folderId: shared.id });
    await expect(publicService.image(access, loop.filename, 400, "webp")).rejects.toThrow(
      "not found",
    );
    await expect(publicService.view(access, { folderId: loop.folder.id })).rejects.toThrow(
      "Not part",
    );
  });
});
