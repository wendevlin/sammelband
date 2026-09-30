import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import * as albumService from "../src/services/album.service";
import * as imageService from "../src/services/image.service";
import * as sectionService from "../src/services/section.service";
import { createUser, inTenant, originalFile, png } from "./helpers";

async function gallery() {
  const user = await createUser();
  const album = await albumService.createAlbum({ title: "A", folderId: null, createdBy: user.id });
  const section = await sectionService.createSection({ albumId: album.id });
  return { user, album, section };
}

describe("photos", () => {
  test(
    "upload stores one file per content hash",
    inTenant(async () => {
      const { user, album, section } = await gallery();
      const first = await imageService.uploadPhoto(png(), section.id, user.id);
      const second = await imageService.uploadPhoto(png(), section.id, user.id);
      const blue = await imageService.uploadPhoto(png([0, 0, 255]), section.id, user.id);

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
      const { user, section } = await gallery();
      const huge = new File([new Uint8Array(51 * 1024 * 1024)], "huge.png", { type: "image/png" });
      await expect(imageService.uploadPhoto(huge, section.id, user.id)).rejects.toThrow(
        "at most 50 MB",
      );
    }),
  );

  test(
    "rejects non-images and unknown sections",
    inTenant(async () => {
      const { user, section } = await gallery();
      await expect(imageService.uploadPhoto(png(), "nope", user.id)).rejects.toThrow(
        "Section not found",
      );
      const pdf = new File(["%PDF"], "x.pdf", { type: "application/pdf" });
      await expect(imageService.uploadPhoto(pdf, section.id, user.id)).rejects.toThrow(
        "Only image",
      );
    }),
  );

  test(
    "deleting a section or album cleans up its files",
    inTenant(async () => {
      const { user, album, section } = await gallery();
      const one = await imageService.uploadPhoto(png(), section.id, user.id);
      await sectionService.deleteSection(section.id);
      expect(existsSync(originalFile(one.imageFile))).toBe(false);

      const second = await sectionService.createSection({ albumId: album.id });
      const two = await imageService.uploadPhoto(png([0, 255, 0]), second.id, user.id);
      await albumService.deleteAlbum(album.id);
      expect(existsSync(originalFile(two.imageFile))).toBe(false);
    }),
  );

  test(
    "the stored cover follows the chosen cover, else the first photo of the first section",
    inTenant(async () => {
      const { user, album, section } = await gallery();
      const cover = async () => (await albumService.getAlbum(album.id))?.cover_filename;
      expect(await cover()).toBeNull();

      const red = await imageService.uploadPhoto(png(), section.id, user.id);
      expect(await cover()).toBe(red.imageFile.filename);

      // A section moved before it takes over.
      const earlier = await sectionService.createSection({ albumId: album.id });
      const blue = await imageService.uploadPhoto(png([0, 0, 255]), earlier.id, user.id);
      expect(await cover()).toBe(red.imageFile.filename);
      await sectionService.reorderSections(album.id, [{ id: earlier.id, sortOrder: 0 }]);
      expect(await cover()).toBe(blue.imageFile.filename);

      // Reordering photos inside the first section.
      const green = await imageService.uploadPhoto(png([0, 255, 0]), earlier.id, user.id);
      await imageService.reorderPhotos(earlier.id, [{ id: green.photo.id, sortOrder: 0 }]);
      expect(await cover()).toBe(green.imageFile.filename);

      // An explicit cover wins; deleting it falls back again.
      await albumService.setCover(album.id, red.photo.id);
      expect(await cover()).toBe(red.imageFile.filename);
      await imageService.deletePhoto(red.photo.id);
      expect(await cover()).toBe(green.imageFile.filename);

      // Deleting the first section falls back to nothing left.
      await sectionService.deleteSection(earlier.id);
      expect(await cover()).toBeNull();
    }),
  );

  test(
    "reorders and captions",
    inTenant(async () => {
      const { user, section } = await gallery();
      const a = await imageService.uploadPhoto(png(), section.id, user.id);
      const b = await imageService.uploadPhoto(png([0, 0, 255]), section.id, user.id);
      await imageService.reorderPhotos(section.id, [
        { id: a.photo.id, sortOrder: 2 },
        { id: b.photo.id, sortOrder: 1 },
      ]);
      await imageService.updateCaption(a.photo.id, "Hello");
      const photos = await imageService.photosWithImage({ sectionId: section.id });
      expect(photos.map((p) => [p.id, p.caption])).toEqual([
        [b.photo.id, null],
        [a.photo.id, "Hello"],
      ]);
    }),
  );
});

describe("moving photos", () => {
  test(
    "into another section of the album, at a position or the end",
    inTenant(async () => {
      const { user, album, section } = await gallery();
      const other = await sectionService.createSection({ albumId: album.id });
      const a = await imageService.uploadPhoto(png(), section.id, user.id);
      const b = await imageService.uploadPhoto(png([0, 0, 255]), other.id, user.id);
      const c = await imageService.uploadPhoto(png([0, 255, 0]), other.id, user.id);

      await imageService.movePhoto(a.photo.id, other.id, c.photo.id);
      const ids = async (sectionId: string) =>
        (await imageService.photosWithImage({ sectionId })).map((p) => p.id);
      expect(await ids(other.id)).toEqual([b.photo.id, a.photo.id, c.photo.id]);
      expect(await ids(section.id)).toEqual([]);

      await imageService.movePhoto(b.photo.id, other.id, null);
      expect(await ids(other.id)).toEqual([a.photo.id, c.photo.id, b.photo.id]);
    }),
  );

  test(
    "only into sections of the same album",
    inTenant(async () => {
      const { user, section } = await gallery();
      const elsewhere = await gallery();
      const p = await imageService.uploadPhoto(png(), section.id, user.id);
      await expect(imageService.movePhoto(p.photo.id, elsewhere.section.id, null)).rejects.toThrow(
        "Section not found",
      );
    }),
  );
});
