import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { subscribe } from "../src/lib/events";
import { runInTenant } from "../src/lib/tenant-context";
import * as albumService from "../src/services/album.service";
import * as blockService from "../src/services/block.service";
import * as folderService from "../src/services/folder.service";
import * as imageService from "../src/services/image.service";
import * as imageDelivery from "../src/services/image-delivery.service";
import * as userService from "../src/services/user.service";
import { createTenant, createUser, originalFile, png } from "./helpers";

/** Tenant A with one of everything; the tests then act as tenant B. */
async function setup() {
  const a = await createTenant("A");
  const b = await createTenant("B");
  const data = await runInTenant(a.id, async () => {
    const user = await createUser("admin");
    const folder = await folderService.createFolder({
      name: "Private",
      parentId: null,
      createdBy: user.id,
    });
    const album = await albumService.createAlbum({
      title: "Secret",
      folderId: folder.id,
      createdBy: user.id,
    });
    const block = await blockService.createBlock({
      albumId: album.id,
      type: "gallery",
      content: {},
    });
    const upload = await imageService.uploadPhoto(png(), block.id, user.id);
    return { user, folder, album, block, upload, path: originalFile(upload.imageFile) };
  });
  const asB = <T>(fn: () => Promise<T>) => runInTenant(b.id, fn);
  const bUser = await asB(() => createUser("admin"));
  return { a, b, asB, bUser, ...data };
}

describe("tenant isolation", () => {
  test("folders", async () => {
    const { asB, folder, bUser } = await setup();
    await asB(async () => {
      expect(await folderService.listFolders()).toEqual([]);
      expect(await folderService.getFolder(folder.id)).toBeNull();
      await expect(folderService.getFolderContents(folder.id, bUser.id)).rejects.toThrow(
        "not found",
      );
      await expect(folderService.updateFolder(folder.id, { name: "x" })).rejects.toThrow(
        "not found",
      );
      await expect(folderService.deleteFolder(folder.id)).rejects.toThrow("not found");
      await expect(
        folderService.createFolder({ name: "x", parentId: folder.id, createdBy: bUser.id }),
      ).rejects.toThrow("not found");
    });
  });

  test("albums", async () => {
    const { asB, folder, album, upload, bUser } = await setup();
    await asB(async () => {
      expect(await albumService.listAlbums()).toEqual([]);
      expect(await albumService.getAlbum(album.id)).toBeNull();
      expect(await albumService.resolveAlbum(album.short_id)).toBeNull();
      await expect(albumService.getAlbumDetail(album.short_id)).rejects.toThrow("not found");
      await expect(albumService.updateAlbum(album.id, { title: "x" })).rejects.toThrow("not found");
      await expect(albumService.setCover(album.id, upload.photo.id)).rejects.toThrow("not found");
      await expect(albumService.deleteAlbum(album.id)).rejects.toThrow("not found");
      await expect(
        albumService.createAlbum({ title: "x", folderId: folder.id, createdBy: bUser.id }),
      ).rejects.toThrow("Folder not found");
      // Same slug is fine in another tenant.
      const own = await albumService.createAlbum({
        title: "Secret",
        folderId: null,
        createdBy: bUser.id,
      });
      await expect(albumService.setCover(own.id, upload.photo.id)).rejects.toThrow("not found");
    });
  });

  test("blocks", async () => {
    const { asB, album, block } = await setup();
    await asB(async () => {
      expect(await blockService.listBlocks(album.id)).toEqual([]);
      expect(await blockService.getBlock(block.id)).toBeNull();
      await expect(
        blockService.createBlock({ albumId: album.id, type: "text", content: {} }),
      ).rejects.toThrow("Album not found");
      await expect(blockService.updateBlock(block.id, { content: {} })).rejects.toThrow(
        "not found",
      );
      await expect(blockService.deleteBlock(block.id)).rejects.toThrow("not found");
      await blockService.reorderBlocks(album.id, [{ id: block.id, sortOrder: 99 }]);
    });
    expect(block.sort_order).toBe(1);
  });

  test("photos and image files", async () => {
    const { a, asB, block, upload, path, bUser } = await setup();
    await asB(async () => {
      await expect(imageService.uploadPhoto(png(), block.id, bUser.id)).rejects.toThrow(
        "not found",
      );
      await expect(imageService.updateCaption(upload.photo.id, "x")).rejects.toThrow("not found");
      await expect(imageService.deletePhoto(upload.photo.id)).rejects.toThrow("not found");
      await expect(imageDelivery.serveOriginal(upload.imageFile.filename)).rejects.toThrow(
        "not found",
      );
      await expect(
        imageDelivery.serveVariant(upload.imageFile.filename, 400, "webp"),
      ).rejects.toThrow("not found");
      await imageService.reorderPhotos(block.id, [{ id: upload.photo.id, sortOrder: 9 }]);
      expect(await imageService.photosWithImage({ blockId: block.id })).toEqual([]);
    });
    expect(existsSync(path)).toBe(true);
    const photos = await runInTenant(a.id, () =>
      imageService.photosWithImage({ blockId: block.id }),
    );
    expect(photos.map((p) => p.sort_order)).toEqual([1]);
  });

  test("the same image is stored separately per tenant", async () => {
    const { asB, upload, path, bUser } = await setup();
    const own = await asB(async () => {
      const album = await albumService.createAlbum({
        title: "Mine",
        folderId: null,
        createdBy: bUser.id,
      });
      const gallery = await blockService.createBlock({
        albumId: album.id,
        type: "gallery",
        content: {},
      });
      const result = await imageService.uploadPhoto(png(), gallery.id, bUser.id);
      return { ...result, path: originalFile(result.imageFile) };
    });
    expect(own.deduplicated).toBe(false);
    expect(own.imageFile.content_hash).toBe(upload.imageFile.content_hash);
    expect(own.imageFile.id).not.toBe(upload.imageFile.id);
    expect(own.path).not.toBe(path);
    expect(existsSync(own.path)).toBe(true);
  });

  test("users", async () => {
    const { asB, user, bUser } = await setup();
    await asB(async () => {
      expect((await userService.listUsers()).map((u) => u.id)).toEqual([bUser.id]);
      expect(await userService.getUser(user.id)).toBeNull();
      await expect(userService.updateUser(bUser.id, user.id, { name: "x" })).rejects.toThrow(
        "not found",
      );
      await expect(userService.setPassword(user.id, "hijacked-123")).rejects.toThrow("not found");
      await expect(userService.deleteUser(bUser.id, user.id)).rejects.toThrow("not found");
    });
  });

  test("change events stay within the tenant", async () => {
    const { a, b, asB, bUser } = await setup();
    const seenByA: string[] = [];
    const seenByB: string[] = [];
    const offA = subscribe(a.id, "folder-tree", (e) => seenByA.push(e.kind));
    const offB = subscribe(b.id, "folder-tree", (e) => seenByB.push(e.kind));
    await asB(() => folderService.createFolder({ name: "x", parentId: null, createdBy: bUser.id }));
    offA();
    offB();
    expect(seenByA).toEqual([]);
    expect(seenByB).toEqual(["created"]);
  });
});
