import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { db } from "../src/db/client";
import { originalPath } from "../src/lib/storage-paths";
import * as albumService from "../src/services/album.service";
import * as imageService from "../src/services/image.service";
import * as sectionService from "../src/services/section.service";
import * as tenantService from "../src/services/tenant.service";
import * as videoService from "../src/services/video.service";
import { createUser, inTenant, png, streamOf, testVideo } from "./helpers";

async function photo(rgb: [number, number, number] = [255, 0, 0]) {
  const user = await createUser();
  const album = await albumService.createAlbum({ title: "A", folderId: null, createdBy: user.id });
  const section = await sectionService.createSection({ albumId: album.id });
  const uploaded = await imageService.uploadPhoto(png(rgb), section.id, user.id);
  return { user, album, section, ...uploaded };
}

const used = async () => (await tenantService.currentTenant()).storage_used_bytes;
const fileCount = async () => (await db.selectFrom("image_files").select("id").execute()).length;

const turned = { rotate: 90, crop: { x: 0, y: 0, w: 1, h: 1 } } as const;
const cropped = { rotate: 0, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } } as const;

describe("photo edits", () => {
  test(
    "an edit shows the edited image and keeps the original to edit again",
    inTenant(async () => {
      const { photo: p, imageFile: original } = await photo();
      // The browser sends the result: here a turned 30×40 image.
      const edited = await imageService.editPhoto(p.id, png([255, 0, 0], "e.png", 30, 40), turned);
      expect(edited).toMatchObject({
        width: 30,
        height: 40,
        source_filename: original.filename,
        edit: turned,
      });
      expect(edited.filename).not.toBe(original.filename);
      expect(existsSync(originalPath(original.filename))).toBe(true);

      // Again: from the original; the first result goes.
      const again = await imageService.editPhoto(p.id, png([255, 0, 0], "e.png", 20, 15), cropped);
      expect(again).toMatchObject({ source_filename: original.filename, edit: cropped });
      expect(existsSync(originalPath(edited.filename))).toBe(false);
      expect(await fileCount()).toBe(2);

      // Reset: the original again, nothing else kept.
      const reset = await imageService.resetPhoto(p.id);
      expect(reset).toMatchObject({
        filename: original.filename,
        source_filename: null,
        edit: null,
      });
      expect(existsSync(originalPath(again.filename))).toBe(false);
      expect(await fileCount()).toBe(1);
      expect(await used()).toBe(Number(original.file_size));
    }),
  );

  test(
    "two edits at once leave no file behind",
    inTenant(async () => {
      const { photo: p } = await photo([200, 100, 0]);
      await Promise.all([
        imageService.editPhoto(p.id, png([1, 2, 3], "a.png", 10, 10), cropped),
        imageService.editPhoto(p.id, png([4, 5, 6], "b.png", 12, 12), turned),
      ]);
      // The original and the edit that won, nothing else, and only they counted.
      expect(await fileCount()).toBe(2);
      const files = await db.selectFrom("image_files").select("file_size").execute();
      expect(await used()).toBe(files.reduce((n, f) => n + Number(f.file_size), 0));
    }),
  );

  test(
    "an edit that gives back the original keeps no edit",
    inTenant(async () => {
      const { photo: p, imageFile: original } = await photo([0, 255, 0]);
      const same = await imageService.editPhoto(p.id, png([0, 255, 0]), turned);
      expect(same).toMatchObject({
        filename: original.filename,
        edit: null,
        source_filename: null,
      });
      expect(await fileCount()).toBe(1);
    }),
  );

  test(
    "an original another photo shows, or an edit made from it, stays",
    inTenant(async () => {
      const { photo: p, imageFile: original, section, user } = await photo([0, 0, 255]);
      const { photo: twin } = await imageService.uploadPhoto(png([0, 0, 255]), section.id, user.id);
      const edited = await imageService.editPhoto(p.id, png([9, 9, 9], "e.png", 10, 10), cropped);

      // Deleting the unedited twin: the original is still the edit's source.
      await imageService.deletePhoto(twin.id);
      expect(existsSync(originalPath(original.filename))).toBe(true);
      // Deleting the edited photo: both of its files go, and their storage.
      await imageService.deletePhoto(p.id);
      expect(existsSync(originalPath(original.filename))).toBe(false);
      expect(existsSync(originalPath(edited.filename))).toBe(false);
      expect(await fileCount()).toBe(0);
      expect(await used()).toBe(0);
    }),
  );

  test(
    "videos and broken edits are refused",
    inTenant(async () => {
      const { section, user } = await photo();
      const { photo: video } = await videoService.uploadVideo(
        streamOf(await testVideo({ hue: 77 })),
        section.id,
        user.id,
      );
      await videoService.videosIdle();
      await expect(imageService.editPhoto(video.id, png(), turned)).rejects.toThrow("Only images");
      const parse = (e: unknown) => imageService.editSchema.safeParse(e).success;
      expect(parse(turned)).toBe(true);
      expect(parse({ rotate: 45, crop: turned.crop })).toBe(false);
      expect(parse({ rotate: 0, crop: { x: 0.6, y: 0, w: 0.5, h: 1 } })).toBe(false);
      expect(parse({ rotate: 0, crop: { x: 0, y: 0, w: 0, h: 1 } })).toBe(false);
    }),
  );
});
