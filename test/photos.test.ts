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
    "rejects files over the upload limit before reading them",
    inTenant(async () => {
      const { user, block } = await gallery();
      const huge = new File([new Uint8Array(51 * 1024 * 1024)], "huge.png", { type: "image/png" });
      await expect(imageService.uploadPhoto(huge, block.id, user.id)).rejects.toThrow(
        "at most 50 MB",
      );
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
    "the stored cover follows the chosen cover, else the first photo of the first gallery",
    inTenant(async () => {
      const { user, album, block } = await gallery();
      const cover = async () => (await albumService.getAlbum(album.id))?.cover_filename;
      expect(await cover()).toBeNull();

      const red = await imageService.uploadPhoto(png(), block.id, user.id);
      expect(await cover()).toBe(red.imageFile.filename);

      // A gallery moved before it takes over.
      const earlier = await blockService.createBlock({
        albumId: album.id,
        type: "gallery",
        content: {},
      });
      const blue = await imageService.uploadPhoto(png([0, 0, 255]), earlier.id, user.id);
      expect(await cover()).toBe(red.imageFile.filename);
      await blockService.reorderBlocks(album.id, [{ id: earlier.id, sortOrder: 0 }]);
      expect(await cover()).toBe(blue.imageFile.filename);

      // Reordering photos inside the first gallery.
      const green = await imageService.uploadPhoto(png([0, 255, 0]), earlier.id, user.id);
      await imageService.reorderPhotos(earlier.id, [{ id: green.photo.id, sortOrder: 0 }]);
      expect(await cover()).toBe(green.imageFile.filename);

      // An explicit cover wins; deleting it falls back again.
      await albumService.setCover(album.id, red.photo.id);
      expect(await cover()).toBe(red.imageFile.filename);
      await imageService.deletePhoto(red.photo.id);
      expect(await cover()).toBe(green.imageFile.filename);

      // Deleting the first gallery falls back to nothing left.
      await blockService.deleteBlock(earlier.id);
      expect(await cover()).toBeNull();
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
