import { describe, expect, test } from "bun:test";
import * as albumService from "../src/services/album.service";
import * as folderService from "../src/services/folder.service";
import * as imageService from "../src/services/image.service";
import * as sectionService from "../src/services/section.service";
import { createUser, inTenant, png } from "./helpers";

type RGB = [number, number, number];

/** An album in `folderId`, with one photo of the given color unless null (cover ""). */
async function album(userId: string, folderId: string | null, color: RGB | null) {
  const a = await albumService.createAlbum({ title: "A", folderId, createdBy: userId });
  if (color) {
    const section = await sectionService.createSection({ albumId: a.id });
    const { imageFile } = await imageService.uploadPhoto(png(color), section.id, userId);
    await Bun.sleep(2); // distinct created_at for a stable order
    return { album: a, cover: imageFile.filename };
  }
  await Bun.sleep(2);
  return { album: a, cover: "" };
}

const folder = (userId: string, name: string, parentId: string | null = null) =>
  folderService.createFolder({ name, parentId, createdBy: userId });

describe("folder tiles", () => {
  test("preview the newest album covers, at most four, skipping albums without images", async () => {
    await inTenant(async () => {
      const user = await createUser();
      const f = await folder(user.id, "Trips");
      const covers: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { cover } = await album(user.id, f.id, [i * 40, 0, 0]);
        covers.push(cover);
      }
      await album(user.id, f.id, null); // newest, but no image

      const [tile] = await folderService.withPreviews([f], user.id);
      expect(tile?.covers).toEqual(covers.slice(1).reverse());
      expect(tile?.album_count).toBe(6);
      expect(tile?.folder_count).toBe(0);
    })();
  });

  test("a folder with only sub-folders previews their albums", async () => {
    await inTenant(async () => {
      const user = await createUser();
      const parent = await folder(user.id, "People");
      const anna = await folder(user.id, "Anna", parent.id);
      const ben = await folder(user.id, "Ben", parent.id);
      const a = await album(user.id, anna.id, [255, 0, 0]);
      const b = await album(user.id, ben.id, [0, 0, 255]);
      const deep = await folder(user.id, "Deep", anna.id);
      await album(user.id, deep.id, [0, 255, 0]); // two levels down: ignored

      const [tile] = await folderService.withPreviews([parent], user.id);
      expect(tile?.covers).toEqual([b.cover, a.cover]);
      expect(tile?.album_count).toBe(0);
      expect(tile?.folder_count).toBe(2);
    })();
  });

  test("own albums win over sub-folders; empty folders have no covers", async () => {
    await inTenant(async () => {
      const user = await createUser();
      const f = await folder(user.id, "Mixed");
      const sub = await folder(user.id, "Sub", f.id);
      await album(user.id, sub.id, [0, 0, 255]);
      const own = await album(user.id, f.id, [255, 0, 0]);
      const empty = await folder(user.id, "Empty");

      const tiles = await folderService.withPreviews([f, empty], user.id);
      expect(tiles.map((t) => t.covers)).toEqual([[own.cover], []]);
    })();
  });

  test("library and folder contents return tiles and albums with covers", async () => {
    await inTenant(async () => {
      const user = await createUser();
      const f = await folder(user.id, "F");
      const sub = await folder(user.id, "Sub", f.id);
      const inSub = await album(user.id, sub.id, [255, 0, 0]);
      const root = await album(user.id, null, [0, 0, 255]);

      const library = await folderService.getLibrary(user.id);
      expect(library.folders.map((t) => [t.name, t.covers])).toEqual([["F", [inSub.cover]]]);
      expect(library.albums.map((a) => [a.id, a.cover_filename])).toEqual([
        [root.album.id, root.cover],
      ]);

      const contents = await folderService.getFolderContents(f.id, user.id);
      expect(contents.folders.map((t) => [t.name, t.covers])).toEqual([["Sub", [inSub.cover]]]);
      expect(contents.albums).toEqual([]);
    })();
  });
});
