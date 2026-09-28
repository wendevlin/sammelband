import { describe, expect, test } from "bun:test";
import * as albumService from "../src/services/album.service";
import * as folderService from "../src/services/folder.service";
import { createUser } from "./helpers";

describe("albums", () => {
  test("slugs are unique per folder, including the root", async () => {
    const user = await createUser();
    const folder = await folderService.createFolder({
      name: "F",
      parentId: null,
      createdBy: user.id,
    });
    const create = (folderId: string | null) =>
      albumService.createAlbum({ title: "Rome 2026!", folderId, createdBy: user.id });

    expect((await create(null)).slug).toBe("rome-2026");
    expect((await create(null)).slug).toBe("rome-2026-2");
    expect((await create(folder.id)).slug).toBe("rome-2026");
    expect((await create(folder.id)).slug).toBe("rome-2026-2");
  });

  test("resolves by short id regardless of the slug part", async () => {
    const user = await createUser();
    const album = await albumService.createAlbum({
      title: "Summer",
      folderId: null,
      createdBy: user.id,
    });
    expect(album.short_id).toHaveLength(8);
    expect((await albumService.resolveAlbum(`summer-${album.short_id}`))?.id).toBe(album.id);
    expect((await albumService.resolveAlbum(`renamed-${album.short_id}`))?.id).toBe(album.id);
    expect(await albumService.resolveAlbum("summer-nope")).toBeNull();
  });

  test("renaming and moving re-slugs without colliding with itself", async () => {
    const user = await createUser();
    const folder = await folderService.createFolder({
      name: "F",
      parentId: null,
      createdBy: user.id,
    });
    const a = await albumService.createAlbum({ title: "Trip", folderId: null, createdBy: user.id });
    await albumService.createAlbum({ title: "Trip", folderId: folder.id, createdBy: user.id });

    expect((await albumService.updateAlbum(a.id, { title: "Trip" })).slug).toBe("trip");
    const moved = await albumService.updateAlbum(a.id, { folderId: folder.id });
    expect(moved.folder_id).toBe(folder.id);
    expect(moved.slug).toBe("trip-2");
    await expect(albumService.updateAlbum(a.id, { folderId: "missing" })).rejects.toThrow(
      "Folder not found",
    );
  });

  test("lists newest first", async () => {
    const user = await createUser();
    const first = await albumService.createAlbum({
      title: "1",
      folderId: null,
      createdBy: user.id,
    });
    await Bun.sleep(2);
    const second = await albumService.createAlbum({
      title: "2",
      folderId: null,
      createdBy: user.id,
    });
    const ids = (await albumService.listAlbums()).map((a) => a.id);
    expect(ids).toEqual([second.id, first.id]);
  });
});
