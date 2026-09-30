import { describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { runInTenant } from "../src/lib/tenant-context";
import * as albumService from "../src/services/album.service";
import * as folderService from "../src/services/folder.service";
import * as imageService from "../src/services/image.service";
import * as sectionService from "../src/services/section.service";
import { sortItems } from "../src/services/sort.service";
import { createTenant, createUser, inTenant, png } from "./helpers";

const item = (id: string, name: string, created_at: number, modified_at = created_at) => ({
  id,
  name,
  created_at,
  modified_at,
});

describe("sortItems", () => {
  const items = [item("a", "Trip 10", 1, 5), item("b", "trip 2", 2, 3), item("c", "Äpfel", 3, 1)];
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  test("name is locale-aware, case-insensitive and numeric", () => {
    expect(ids(sortItems(items, "name"))).toEqual(["c", "b", "a"]);
  });

  test("created and modified are newest first", () => {
    expect(ids(sortItems(items, "created"))).toEqual(["c", "b", "a"]);
    expect(ids(sortItems(items, "modified"))).toEqual(["a", "b", "c"]);
  });

  test("manual puts unpositioned items last, oldest first", () => {
    const positions = new Map([
      ["c", 1],
      ["a", 2],
    ]);
    const more = [...items, item("d", "D", 4), item("e", "E", 0)];
    expect(ids(sortItems(more, "manual", positions))).toEqual(["c", "a", "e", "b", "d"]);
  });
});

/** Albums A, B, C (created in that order) in a folder, as seen by `user`. */
async function setup() {
  const user = await createUser();
  const folder = await folderService.createFolder({
    name: "F",
    parentId: null,
    createdBy: user.id,
  });
  const albums = [];
  for (const title of ["A", "B", "C"]) {
    albums.push(await albumService.createAlbum({ title, folderId: folder.id, createdBy: user.id }));
    await Bun.sleep(2);
  }
  const titles = async (userId = user.id) =>
    (await folderService.getFolderContents(folder.id, userId)).albums.map((a) => a.title);
  const [a, b, c] = albums as [(typeof albums)[0], (typeof albums)[0], (typeof albums)[0]];
  return { user, folder, a, b, c, titles };
}

const positionRows = () => db.selectFrom("album_positions").selectAll().execute();

describe("folder sort order", () => {
  test("defaults to newest first; the chosen mode is stored per folder", async () => {
    await inTenant(async () => {
      const { user, folder, titles } = await setup();
      expect(await titles()).toEqual(["C", "B", "A"]);
      expect((await folderService.getFolderContents(folder.id, user.id)).sort).toBe("created");
      await folderService.setSortMode(folder.id, user.id, "name");
      expect(await titles()).toEqual(["A", "B", "C"]);
      expect((await folderService.getLibrary(user.id)).sort).toBe("created");
    })();
  });

  test("choosing manual keeps the order shown, or restores the saved one", async () => {
    await inTenant(async () => {
      const { user, folder, a, titles } = await setup();
      await folderService.setSortMode(folder.id, user.id, "name");
      await folderService.setSortMode(folder.id, user.id, "manual");
      expect(await titles()).toEqual(["A", "B", "C"]);
      await folderService.moveItem(folder.id, user.id, { kind: "album", id: a.id, beforeId: null });
      expect(await titles()).toEqual(["B", "C", "A"]);
      await folderService.setSortMode(folder.id, user.id, "created");
      await folderService.setSortMode(folder.id, user.id, "manual");
      expect(await titles()).toEqual(["B", "C", "A"]);
    })();
  });

  test("the first move switches to manual, starting from the order shown", async () => {
    await inTenant(async () => {
      const { user, folder, a, titles } = await setup(); // shown: C B A
      const result = await folderService.moveItem(folder.id, user.id, {
        kind: "album",
        id: a.id,
        beforeId: null,
      });
      expect(result.sort).toBe("manual");
      expect(await titles()).toEqual(["C", "B", "A"]);
      await folderService.moveItem(folder.id, user.id, { kind: "album", id: a.id, beforeId: null });
      expect(await titles()).toEqual(["C", "B", "A"]);
    })();
  });

  test("later moves write a single position", async () => {
    await inTenant(async () => {
      const { user, folder, a, b, c, titles } = await setup();
      await folderService.setSortMode(folder.id, user.id, "name"); // A B C
      await folderService.moveItem(folder.id, user.id, { kind: "album", id: c.id, beforeId: a.id });
      expect(await titles()).toEqual(["C", "A", "B"]);
      const before = await positionRows();

      await folderService.moveItem(folder.id, user.id, { kind: "album", id: b.id, beforeId: a.id });
      expect(await titles()).toEqual(["C", "B", "A"]);
      const after = await positionRows();
      const changed = after.filter(
        (r) => before.find((p) => p.album_id === r.album_id)?.position !== r.position,
      );
      expect(changed.map((r) => r.album_id)).toEqual([b.id]);
    })();
  });

  test("new albums go to the end; moving next to them numbers the tail once", async () => {
    await inTenant(async () => {
      const { user, folder, a, titles } = await setup();
      await folderService.moveItem(folder.id, user.id, { kind: "album", id: a.id, beforeId: null });
      await albumService.createAlbum({
        title: "D",
        folderId: folder.id,
        createdBy: user.id,
      });
      await Bun.sleep(2);
      const e = await albumService.createAlbum({
        title: "E",
        folderId: folder.id,
        createdBy: user.id,
      });
      expect(await titles()).toEqual(["C", "B", "A", "D", "E"]);

      await folderService.moveItem(folder.id, user.id, { kind: "album", id: a.id, beforeId: e.id });
      expect(await titles()).toEqual(["C", "B", "D", "A", "E"]);
      // A, B, C were numbered by the switch to manual; D and E just now.
      expect(await positionRows()).toHaveLength(5);
    })();
  });

  test("renumbers when repeated moves exhaust the gap", async () => {
    await inTenant(async () => {
      const { user, folder, a, c, titles } = await setup(); // shown: C B A
      const move = (id: string, beforeId: string | null) =>
        folderService.moveItem(folder.id, user.id, { kind: "album", id, beforeId });
      await move(c.id, null); // B A C
      // Swapping A and C halves the gap after B every time.
      for (let i = 0; i < 30; i++) {
        await move(c.id, a.id); // B C A
        await move(a.id, c.id); // B A C
      }
      expect(await titles()).toEqual(["B", "A", "C"]);
      const positions = (await positionRows()).map((r) => r.position).sort((x, y) => x - y);
      expect((positions[1] ?? 0) - (positions[0] ?? 0)).toBeGreaterThan(1e-6);
    })();
  });

  test("each user has their own mode and order", async () => {
    await inTenant(async () => {
      const { user, folder, a, titles } = await setup();
      const other = await createUser();
      await folderService.moveItem(folder.id, user.id, { kind: "album", id: a.id, beforeId: null });
      await folderService.setSortMode(folder.id, other.id, "name");
      expect(await titles()).toEqual(["C", "B", "A"]);
      expect(await titles(other.id)).toEqual(["A", "B", "C"]);
    })();
  });

  test("folders are ordered too; the root is a container of its own", async () => {
    await inTenant(async () => {
      const user = await createUser();
      const names = async () =>
        (await folderService.getLibrary(user.id)).folders.map((f) => f.name);
      const x = await folderService.createFolder({ name: "X", parentId: null, createdBy: user.id });
      await Bun.sleep(2);
      const y = await folderService.createFolder({ name: "Y", parentId: null, createdBy: user.id });
      expect(await names()).toEqual(["Y", "X"]);
      await folderService.moveItem(null, user.id, { kind: "folder", id: x.id, beforeId: y.id });
      expect(await names()).toEqual(["X", "Y"]);
    })();
  });

  test("modified counts content edits; folders use their albums' edits", async () => {
    await inTenant(async () => {
      const { user, folder, a, titles } = await setup();
      await folderService.setSortMode(folder.id, user.id, "modified");
      expect(await titles()).toEqual(["C", "B", "A"]);
      await Bun.sleep(2);
      await sectionService.createSection({ albumId: a.id });
      expect(await titles()).toEqual(["A", "C", "B"]);

      const empty = await folderService.createFolder({
        name: "Newer",
        parentId: null,
        createdBy: user.id,
      });
      await folderService.setSortMode(null, user.id, "modified");
      await Bun.sleep(2);
      await sectionService.createSection({ albumId: a.id });
      const library = await folderService.getLibrary(user.id);
      expect(library.folders.map((f) => f.name)).toEqual(["F", empty.name]);
    })();
  });

  test("moving an album elsewhere drops its position; previews follow the order", async () => {
    await inTenant(async () => {
      const { user, folder, a, c, titles } = await setup();
      const gallery = await sectionService.createSection({ albumId: a.id });
      const { imageFile: aImage } = await imageService.uploadPhoto(png(), gallery.id, user.id);
      const cGallery = await sectionService.createSection({ albumId: c.id });
      const { imageFile: cImage } = await imageService.uploadPhoto(
        png([0, 0, 255]),
        cGallery.id,
        user.id,
      );

      const cover = async () =>
        (await folderService.getLibrary(user.id)).folders.find((f) => f.id === folder.id)?.covers;
      expect(await cover()).toEqual([cImage.filename, aImage.filename]);
      await folderService.moveItem(folder.id, user.id, { kind: "album", id: a.id, beforeId: c.id });
      expect(await cover()).toEqual([aImage.filename, cImage.filename]);

      await albumService.updateAlbum(a.id, { folderId: null });
      expect(await positionRows()).toHaveLength(2);
      expect(await titles()).toEqual(["C", "B"]);
    })();
  });

  test("other tenants can't sort or move in a folder", async () => {
    const tenant = await createTenant("A");
    const { folder, a } = await runInTenant(tenant.id, setup);
    const other = await createTenant("B");
    await runInTenant(other.id, async () => {
      const intruder = await createUser();
      await expect(folderService.setSortMode(folder.id, intruder.id, "name")).rejects.toThrow(
        "not found",
      );
      await expect(
        folderService.moveItem(folder.id, intruder.id, { kind: "album", id: a.id, beforeId: null }),
      ).rejects.toThrow("not found");
      await expect(
        folderService.moveItem(null, intruder.id, { kind: "album", id: a.id, beforeId: null }),
      ).rejects.toThrow("not found");
    });
    expect(await positionRows()).toEqual([]);
  });
});
