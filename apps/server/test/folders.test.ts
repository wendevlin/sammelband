import { describe, expect, test } from "bun:test";
import * as albumService from "../src/services/album.service";
import * as folderService from "../src/services/folder.service";
import { createUser, inTenant } from "./helpers";

describe("folders", () => {
  test(
    "create, nest and list with root folders first",
    inTenant(async () => {
      const user = await createUser();
      const root = await folderService.createFolder({
        name: " Trips ",
        parentId: null,
        createdBy: user.id,
      });
      const child = await folderService.createFolder({
        name: "Italy",
        parentId: root.id,
        createdBy: user.id,
      });
      expect(root.name).toBe("Trips");
      expect(typeof root.created_at).toBe("number");

      const all = await folderService.listFolders();
      expect(all.map((f) => f.id)).toEqual([root.id, child.id]);

      const contents = await folderService.getFolderContents(root.id, user.id);
      expect(contents.folders.map((f) => f.id)).toEqual([child.id]);
    }),
  );

  test(
    "refuses to move a folder into its own descendant",
    inTenant(async () => {
      const user = await createUser();
      const a = await folderService.createFolder({ name: "A", parentId: null, createdBy: user.id });
      const b = await folderService.createFolder({ name: "B", parentId: a.id, createdBy: user.id });
      await expect(folderService.updateFolder(a.id, { parentId: b.id })).rejects.toThrow(
        "sub-folders",
      );
      await expect(folderService.updateFolder(a.id, { parentId: a.id })).rejects.toThrow(
        "own parent",
      );
    }),
  );

  test(
    "only deletes empty folders",
    inTenant(async () => {
      const user = await createUser();
      const a = await folderService.createFolder({ name: "A", parentId: null, createdBy: user.id });
      const b = await folderService.createFolder({ name: "B", parentId: a.id, createdBy: user.id });
      const album = await albumService.createAlbum({
        title: "X",
        folderId: b.id,
        createdBy: user.id,
      });

      await expect(folderService.deleteFolder(a.id)).rejects.toThrow("sub-folders");
      await expect(folderService.deleteFolder(b.id)).rejects.toThrow("albums");

      await albumService.deleteAlbum(album.id);
      await folderService.deleteFolder(b.id);
      await folderService.deleteFolder(a.id);
      expect(await folderService.listFolders()).toEqual([]);
    }),
  );
});
