import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import * as albumService from "../src/services/album.service";
import * as blockService from "../src/services/block.service";
import * as imageService from "../src/services/image.service";
import { createUser, inTenant, originalFile, png } from "./helpers";

async function gallery() {
  const user = await createUser();
  const album = await albumService.createAlbum({ title: "A", folderId: null, createdBy: user.id });
  const block = await blockService.createBlock({
    albumId: album.id,
    type: "gallery",
    content: {},
  });
  return { user, album, block };
}

describe("photos", () => {
  test(
    "upload stores one file per content hash",
    inTenant(async () => {
      const { user, album, block } = await gallery();
      const first = await imageService.uploadPhoto(png(), block.id, user.id);
      const second = await imageService.uploadPhoto(png(), block.id, user.id);
      const blue = await imageService.uploadPhoto(png([0, 0, 255]), block.id, user.id);

      expect(first.deduplicated).toBe(false);
      expect(second.deduplicated).toBe(true);
      expect(second.imageFile.id).toBe(first.imageFile.id);
      expect(blue.imageFile.id).not.toBe(first.imageFile.id);
      expect([first, second, blue].map((u) => u.photo.sort_order)).toEqual([1, 2, 3]);

      const { photos } = await albumService.getAlbumDetail(album.short_id);
      expect(photos.map((p) => [p.width, p.height])).toEqual([
        [40, 30],
        [40, 30],
        [40, 30],
      ]);
    }),
  );

  test(
    "rejects non-images and non-gallery blocks",
    inTenant(async () => {
      const { user, album } = await gallery();
      const text = await blockService.createBlock({ albumId: album.id, type: "text", content: {} });
      await expect(imageService.uploadPhoto(png(), text.id, user.id)).rejects.toThrow(
        "not a gallery",
      );
      const pdf = new File(["%PDF"], "x.pdf", { type: "application/pdf" });
      await expect(imageService.uploadPhoto(pdf, text.id, user.id)).rejects.toThrow("Only image");
    }),
  );

  test(
    "deleting the last reference removes the file and clears the cover",
    inTenant(async () => {
      const { user, album, block } = await gallery();
      const a = await imageService.uploadPhoto(png(), block.id, user.id);
      const b = await imageService.uploadPhoto(png(), block.id, user.id);
      await albumService.setCover(album.id, a.photo.id);

      await imageService.deletePhoto(a.photo.id);
      expect((await albumService.getAlbum(album.id))?.cover_photo_id).toBeNull();
      expect(existsSync(originalFile(a.imageFile))).toBe(true); // still used by b

      await imageService.deletePhoto(b.photo.id);
      expect(existsSync(originalFile(a.imageFile))).toBe(false);
    }),
  );

  test(
    "deleting a gallery block or album cleans up its files",
    inTenant(async () => {
      const { user, album, block } = await gallery();
      const one = await imageService.uploadPhoto(png(), block.id, user.id);
      await blockService.deleteBlock(block.id);
      expect(existsSync(originalFile(one.imageFile))).toBe(false);

      const second = await blockService.createBlock({
        albumId: album.id,
        type: "gallery",
        content: {},
      });
      const two = await imageService.uploadPhoto(png([0, 255, 0]), second.id, user.id);
      await albumService.deleteAlbum(album.id);
      expect(existsSync(originalFile(two.imageFile))).toBe(false);
    }),
  );

  test(
    "cover falls back to the first photo of the first gallery",
    inTenant(async () => {
      const { user, album, block } = await gallery();
      expect(await albumService.coverFilename(album)).toBeNull();
      const earlier = await blockService.createBlock({
        albumId: album.id,
        type: "gallery",
        content: {},
        position: { afterId: undefined },
      });
      await blockService.reorderBlocks(album.id, [{ id: earlier.id, sortOrder: 0 }]);
      await imageService.uploadPhoto(png(), block.id, user.id);
      const first = await imageService.uploadPhoto(png([0, 0, 255]), earlier.id, user.id);
      expect(await albumService.coverFilename(album)).toBe(first.imageFile.filename);
    }),
  );

  test(
    "reorders and captions",
    inTenant(async () => {
      const { user, block } = await gallery();
      const a = await imageService.uploadPhoto(png(), block.id, user.id);
      const b = await imageService.uploadPhoto(png([0, 0, 255]), block.id, user.id);
      await imageService.reorderPhotos(block.id, [
        { id: a.photo.id, sortOrder: 2 },
        { id: b.photo.id, sortOrder: 1 },
      ]);
      await imageService.updateCaption(a.photo.id, "Hello");
      const photos = await imageService.photosWithImage({ blockId: block.id });
      expect(photos.map((p) => [p.id, p.caption])).toEqual([
        [b.photo.id, null],
        [a.photo.id, "Hello"],
      ]);
    }),
  );
});
