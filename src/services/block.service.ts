import type { AlbumBlock } from "../db/schema";
import { AppError, must } from "../lib/errors";
import { emitAlbumPatch } from "../lib/events";
import { currentTenantId, tdb } from "../lib/tenant-context";
import * as imageService from "./image.service";

const ALLOWED_TYPES = new Set(["heading", "text", "gallery", "group"]);

/**
 * Validate one-level nesting and return the parent id to store. A `group` block
 * can't be nested; a nested block must point at an existing `group` in the same
 * album. Returns null for top-level blocks.
 */
async function resolveParent(
  albumId: string,
  type: string,
  parentId: string | null | undefined,
): Promise<string | null> {
  if (!parentId) return null;
  if (type === "group") throw new AppError(400, "A group cannot be nested in another group");
  const parent = await getBlock(parentId);
  if (!parent || parent.album_id !== albumId) throw new AppError(404, "Parent group not found");
  if (parent.type !== "group") throw new AppError(400, "Parent block is not a group");
  return parentId;
}

export function listBlocks(albumId: string): Promise<AlbumBlock[]> {
  return tdb()
    .selectFrom("album_blocks")
    .selectAll()
    .where("album_id", "=", albumId)
    .orderBy("sort_order")
    .execute();
}

export async function createBlock(input: {
  albumId: string;
  type: string;
  content: unknown;
  parentId?: string | null;
  position?: { afterId?: string };
}): Promise<AlbumBlock> {
  if (!ALLOWED_TYPES.has(input.type)) {
    throw new AppError(400, "Invalid block type");
  }
  const album = await tdb()
    .selectFrom("albums")
    .select("id")
    .where("id", "=", input.albumId)
    .executeTakeFirst();
  if (!album) throw new AppError(404, "Album not found");

  const parentId = await resolveParent(input.albumId, input.type, input.parentId);
  const sortOrder = await nextSortOrder(input.albumId, parentId, input.position?.afterId);

  const id = Bun.randomUUIDv7();
  const now = Date.now();
  await tdb()
    .insertInto("album_blocks")
    .values({
      id,
      tenant_id: currentTenantId(),
      album_id: input.albumId,
      parent_id: parentId,
      sort_order: sortOrder,
      type: input.type as AlbumBlock["type"],
      content: JSON.stringify(input.content),
      created_at: now,
      updated_at: now,
    })
    .execute();
  const block = must(await getBlock(id), "Block");
  await imageService.touchAlbum(input.albumId);
  emitAlbumPatch(input.albumId, { blocks: [block] });
  return block;
}

/** Blocks sharing a parent (or all top-level blocks) of an album. */
function siblings(albumId: string, parentId: string | null) {
  return tdb()
    .selectFrom("album_blocks")
    .select("sort_order")
    .where("album_id", "=", albumId)
    .where("parent_id", parentId === null ? "is" : "=", parentId);
}

// Sibling order is scoped to (album_id, parent_id) so each group has its own sequence.
async function nextSortOrder(
  albumId: string,
  parentId: string | null,
  afterId?: string,
): Promise<number> {
  if (!afterId) {
    const last = await siblings(albumId, parentId)
      .orderBy("sort_order", "desc")
      .limit(1)
      .executeTakeFirst();
    return (last?.sort_order ?? 0) + 1;
  }
  const after = await getBlock(afterId);
  if (!after) throw new AppError(404, "Anchor block not found");
  const next = await siblings(albumId, parentId)
    .where("sort_order", ">", after.sort_order)
    .orderBy("sort_order")
    .limit(1)
    .executeTakeFirst();
  if (!next) return after.sort_order + 1;
  return (after.sort_order + next.sort_order) / 2;
}

export async function getBlock(id: string): Promise<AlbumBlock | null> {
  return (
    (await tdb().selectFrom("album_blocks").selectAll().where("id", "=", id).executeTakeFirst()) ??
    null
  );
}

export async function updateBlock(
  id: string,
  patch: { content?: unknown; type?: string; parentId?: string | null },
): Promise<AlbumBlock> {
  const block = await getBlock(id);
  if (!block) throw new AppError(404, "Block not found");
  const type = patch.type ?? block.type;
  if (patch.type && !ALLOWED_TYPES.has(patch.type)) {
    throw new AppError(400, "Invalid block type");
  }

  // Moving in/out of a group: validate the target and append to its sibling list.
  let parentId = block.parent_id;
  let sortOrder = block.sort_order;
  if (patch.parentId !== undefined && patch.parentId !== block.parent_id) {
    if (patch.parentId === id) throw new AppError(400, "A block cannot be its own parent");
    parentId = await resolveParent(block.album_id, type, patch.parentId);
    sortOrder = await nextSortOrder(block.album_id, parentId);
  }

  await tdb()
    .updateTable("album_blocks")
    .set({
      type: type as AlbumBlock["type"],
      content: patch.content !== undefined ? JSON.stringify(patch.content) : block.content,
      parent_id: parentId,
      sort_order: sortOrder,
      updated_at: Date.now(),
    })
    .where("id", "=", id)
    .execute();
  const updated = must(await getBlock(id), "Block");
  await imageService.touchAlbum(updated.album_id);
  emitAlbumPatch(updated.album_id, { blocks: [updated] });
  return updated;
}

export async function deleteBlock(id: string): Promise<void> {
  const block = await getBlock(id);
  if (!block) throw new AppError(404, "Block not found");
  // A group also owns its children (parent_id has no DB-level cascade).
  const childIds = (
    await tdb().selectFrom("album_blocks").select("id").where("parent_id", "=", id).execute()
  ).map((r) => r.id);
  const blockIds = [id, ...childIds];
  // Galleries own their photos: remove those from disk + variant cache first.
  const removedPhotos = await imageService.deletePhotosByBlocks(blockIds);
  await tdb().deleteFrom("album_blocks").where("id", "in", blockIds).execute();
  await imageService.touchAlbum(block.album_id);
  emitAlbumPatch(block.album_id, {
    removedBlocks: blockIds,
    removedPhotos,
    // The cover may have been one of the removed photos (cleared by a trigger).
    ...(removedPhotos.length > 0 && {
      album: await tdb()
        .selectFrom("albums")
        .selectAll()
        .where("id", "=", block.album_id)
        .executeTakeFirstOrThrow(),
    }),
  });
}

export async function reorderBlocks(
  albumId: string,
  order: { id: string; sortOrder: number }[],
): Promise<void> {
  const now = Date.now();
  await tdb()
    .transaction()
    .execute(async (trx) => {
      for (const entry of order) {
        await trx
          .updateTable("album_blocks")
          .set({ sort_order: entry.sortOrder, updated_at: now })
          .where("id", "=", entry.id)
          .where("album_id", "=", albumId)
          .execute();
      }
    });
  const ids = order.map((e) => e.id);
  if (ids.length === 0) return;
  const blocks = await tdb()
    .selectFrom("album_blocks")
    .selectAll()
    .where("album_id", "=", albumId)
    .where("id", "in", ids)
    .execute();
  await imageService.touchAlbum(albumId);
  emitAlbumPatch(albumId, { blocks });
}
