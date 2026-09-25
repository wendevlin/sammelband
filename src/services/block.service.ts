import { db } from "../db/client";
import type { AlbumBlock } from "../db/schema";
import { AppError } from "../lib/errors";
import { emit, topics } from "../lib/events";
import * as imageService from "./image.service";

const ALLOWED_TYPES = new Set(["heading", "text", "gallery", "group"]);

/**
 * Validate one-level nesting and return the parent id to store. A `group` block
 * can't be nested; a nested block must point at an existing `group` in the same
 * album. Returns null for top-level blocks.
 */
function resolveParent(
  albumId: string,
  type: string,
  parentId: string | null | undefined,
): string | null {
  if (!parentId) return null;
  if (type === "group") throw new AppError(400, "A group cannot be nested in another group");
  const parent = getBlock(parentId);
  if (!parent || parent.album_id !== albumId) throw new AppError(404, "Parent group not found");
  if (parent.type !== "group") throw new AppError(400, "Parent block is not a group");
  return parentId;
}

export function listBlocks(albumId: string): AlbumBlock[] {
  return db
    .query("SELECT * FROM album_blocks WHERE album_id = ? ORDER BY sort_order ASC")
    .all(albumId) as AlbumBlock[];
}

export function createBlock(input: {
  albumId: string;
  type: string;
  content: unknown;
  parentId?: string | null;
  position?: { afterId?: string };
}): AlbumBlock {
  if (!ALLOWED_TYPES.has(input.type)) {
    throw new AppError(400, "Invalid block type");
  }
  if (!db.query("SELECT 1 FROM albums WHERE id = ?").get(input.albumId)) {
    throw new AppError(404, "Album not found");
  }

  const parentId = resolveParent(input.albumId, input.type, input.parentId);
  const sortOrder = nextSortOrder(input.albumId, parentId, input.position?.afterId);

  const id = Bun.randomUUIDv7();
  const now = Date.now();
  db.run(
    `INSERT INTO album_blocks
       (id, album_id, parent_id, sort_order, type, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.albumId, parentId, sortOrder, input.type, JSON.stringify(input.content), now, now],
  );
  const block = getBlock(id)!;
  emit({ topic: topics.album(input.albumId), kind: "updated", id: input.albumId });
  return block;
}

// Sibling order is scoped to (album_id, parent_id) so each group has its own
// sequence. `parent_id IS ?` matches NULL when the bound value is null.
function nextSortOrder(albumId: string, parentId: string | null, afterId?: string): number {
  if (!afterId) {
    const last = db
      .query(
        "SELECT sort_order FROM album_blocks WHERE album_id = ? AND parent_id IS ? ORDER BY sort_order DESC LIMIT 1",
      )
      .get(albumId, parentId) as { sort_order: number } | null;
    return (last?.sort_order ?? 0) + 1;
  }
  const after = db.query("SELECT sort_order FROM album_blocks WHERE id = ?").get(afterId) as {
    sort_order: number;
  } | null;
  if (!after) throw new AppError(404, "Anchor block not found");
  const next = db
    .query(
      "SELECT sort_order FROM album_blocks WHERE album_id = ? AND parent_id IS ? AND sort_order > ? ORDER BY sort_order ASC LIMIT 1",
    )
    .get(albumId, parentId, after.sort_order) as { sort_order: number } | null;
  if (!next) return after.sort_order + 1;
  return (after.sort_order + next.sort_order) / 2;
}

export function getBlock(id: string): AlbumBlock | null {
  return db.query("SELECT * FROM album_blocks WHERE id = ?").get(id) as AlbumBlock | null;
}

export function updateBlock(
  id: string,
  patch: { content?: unknown; type?: string; parentId?: string | null },
): AlbumBlock {
  const block = getBlock(id);
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
    parentId = resolveParent(block.album_id, type, patch.parentId);
    sortOrder = nextSortOrder(block.album_id, parentId);
  }

  db.run(
    "UPDATE album_blocks SET type = ?, content = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?",
    [
      type,
      patch.content !== undefined ? JSON.stringify(patch.content) : block.content,
      parentId,
      sortOrder,
      Date.now(),
      id,
    ],
  );
  const updated = getBlock(id)!;
  emit({ topic: topics.album(updated.album_id), kind: "updated", id: updated.album_id });
  return updated;
}

export function deleteBlock(id: string): void {
  const block = getBlock(id);
  if (!block) throw new AppError(404, "Block not found");
  // A group also owns its children (parent_id has no DB-level cascade).
  const childIds = (
    db.query("SELECT id FROM album_blocks WHERE parent_id = ?").all(id) as { id: string }[]
  ).map((r) => r.id);
  // Galleries own their photos: remove those from disk + variant cache first.
  imageService.deletePhotosByBlocks([id, ...childIds]);
  db.run("DELETE FROM album_blocks WHERE id = ? OR parent_id = ?", [id, id]);
  emit({ topic: topics.album(block.album_id), kind: "updated", id: block.album_id });
}

export function reorderBlocks(albumId: string, order: { id: string; sortOrder: number }[]): void {
  db.transaction(() => {
    for (const entry of order) {
      db.run(
        "UPDATE album_blocks SET sort_order = ?, updated_at = ? WHERE id = ? AND album_id = ?",
        [entry.sortOrder, Date.now(), entry.id, albumId],
      );
    }
  })();
  emit({ topic: topics.album(albumId), kind: "updated", id: albumId });
}
