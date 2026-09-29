import { describe, expect, test } from "bun:test";
import * as albumService from "../src/services/album.service";
import * as blockService from "../src/services/block.service";
import { createUser, inTenant } from "./helpers";

async function album() {
  const user = await createUser();
  return albumService.createAlbum({ title: "A", folderId: null, createdBy: user.id });
}

describe("blocks", () => {
  test(
    "appends, inserts after an anchor, and orders per parent",
    inTenant(async () => {
      const { id: albumId } = await album();
      const a = await blockService.createBlock({
        albumId,
        type: "heading",
        content: { text: "a" },
      });
      const c = await blockService.createBlock({ albumId, type: "text", content: {} });
      const b = await blockService.createBlock({
        albumId,
        type: "text",
        content: {},
        position: { afterId: a.id },
      });
      expect([a.sort_order, b.sort_order, c.sort_order]).toEqual([1, 1.5, 2]);

      // Children of a group have their own sequence.
      const group = await blockService.createBlock({ albumId, type: "group", content: {} });
      const child = await blockService.createBlock({
        albumId,
        type: "text",
        content: {},
        parentId: group.id,
      });
      expect(child.sort_order).toBe(1);
      expect(child.parent_id).toBe(group.id);

      const order = (await blockService.listBlocks(albumId)).map((x) => x.id);
      expect(order).toEqual([a.id, child.id, b.id, c.id, group.id]);
    }),
  );

  test(
    "allows one level of nesting only",
    inTenant(async () => {
      const { id: albumId } = await album();
      const group = await blockService.createBlock({ albumId, type: "group", content: {} });
      const text = await blockService.createBlock({ albumId, type: "text", content: {} });
      await expect(
        blockService.createBlock({ albumId, type: "group", content: {}, parentId: group.id }),
      ).rejects.toThrow("cannot be nested");
      await expect(
        blockService.createBlock({ albumId, type: "text", content: {}, parentId: text.id }),
      ).rejects.toThrow("not a group");
      await expect(
        blockService.createBlock({ albumId, type: "video", content: {} }),
      ).rejects.toThrow("Invalid block type");
    }),
  );

  test(
    "moving into a group appends to its children; deleting a group removes them",
    inTenant(async () => {
      const { id: albumId } = await album();
      const group = await blockService.createBlock({ albumId, type: "group", content: {} });
      const text = await blockService.createBlock({ albumId, type: "text", content: { t: 1 } });

      const moved = await blockService.updateBlock(text.id, { parentId: group.id });
      expect(moved.parent_id).toBe(group.id);
      expect(moved.sort_order).toBe(1);
      expect(JSON.parse(moved.content)).toEqual({ t: 1 });

      await blockService.deleteBlock(group.id);
      expect(await blockService.listBlocks(albumId)).toEqual([]);
    }),
  );

  test(
    "reorders within the album only",
    inTenant(async () => {
      const { id: albumId } = await album();
      const other = await album();
      const a = await blockService.createBlock({ albumId, type: "text", content: {} });
      const b = await blockService.createBlock({ albumId, type: "text", content: {} });
      const foreign = await blockService.createBlock({
        albumId: other.id,
        type: "text",
        content: {},
      });

      await blockService.reorderBlocks(albumId, [
        { id: a.id, sortOrder: 5 },
        { id: b.id, sortOrder: 4 },
        { id: foreign.id, sortOrder: 99 },
      ]);
      expect((await blockService.listBlocks(albumId)).map((x) => x.id)).toEqual([b.id, a.id]);
      expect((await blockService.getBlock(foreign.id))?.sort_order).toBe(1);
    }),
  );
});

describe("inserting blocks", () => {
  test("before a block, including before the first one", async () => {
    await inTenant(async () => {
      const { id: albumId } = await album();
      const a = await blockService.createBlock({ albumId, type: "text", content: {} });
      const b = await blockService.createBlock({ albumId, type: "text", content: {} });
      const first = await blockService.createBlock({
        albumId,
        type: "heading",
        content: {},
        position: { beforeId: a.id },
      });
      const middle = await blockService.createBlock({
        albumId,
        type: "heading",
        content: {},
        position: { beforeId: b.id },
      });
      const order = (await blockService.listBlocks(albumId)).map((x) => x.id);
      expect(order).toEqual([first.id, a.id, middle.id, b.id]);
    })();
  });
});
