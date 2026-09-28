import type { SortMode } from "../db/schema";
import { AppError } from "../lib/errors";
import { currentTenantId, tdb } from "../lib/tenant-context";

// Per-user order of a container's contents (the library root or a folder).
// Sorting happens here in JS rather than in SQL, so name order is the same on
// SQLite and Postgres (locale-aware, numbers in names sort naturally).

export type { SortMode };
export type Kind = "album" | "folder";

/** Container key for the top level of the library. */
export const ROOT = "root";
export const SORT_MODES: readonly SortMode[] = ["name", "created", "modified", "manual"];
export const DEFAULT_MODE: SortMode = "created";

/** Gap between positions when (re)numbering; moves then halve gaps. */
const GAP = 1024;
/** Below this, neighbours are renumbered instead of halving further. */
const MIN_GAP = 1e-6;

export type SortableItem = { id: string; name: string; created_at: number; modified_at: number };

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const keyOf = (folderId: string | null) => folderId ?? ROOT;

export async function getMode(userId: string | null, folderId: string | null): Promise<SortMode> {
  return (await getModes(userId, [keyOf(folderId)])).get(keyOf(folderId)) ?? DEFAULT_MODE;
}

/** Stored modes for several containers; missing ones (and a null user) use DEFAULT_MODE. */
export async function getModes(
  userId: string | null,
  keys: string[],
): Promise<Map<string, SortMode>> {
  if (!userId || keys.length === 0) return new Map();
  const rows = await tdb()
    .selectFrom("folder_sort")
    .select(["folder_key", "mode"])
    .where("user_id", "=", userId)
    .where("folder_key", "in", keys)
    .execute();
  return new Map(rows.map((r) => [r.folder_key, r.mode]));
}

export async function setMode(userId: string, folderId: string | null, mode: SortMode) {
  const key = keyOf(folderId);
  await tdb()
    .transaction()
    .execute(async (trx) => {
      await trx
        .deleteFrom("folder_sort")
        .where("user_id", "=", userId)
        .where("folder_key", "=", key)
        .execute();
      await trx
        .insertInto("folder_sort")
        .values({ tenant_id: currentTenantId(), user_id: userId, folder_key: key, mode })
        .execute();
    });
}

/** The user's manual positions of the given items. */
export async function getPositions(
  userId: string | null,
  kind: Kind,
  ids: string[],
): Promise<Map<string, number>> {
  if (!userId || ids.length === 0) return new Map();
  const rows =
    kind === "album"
      ? await tdb()
          .selectFrom("album_positions")
          .select(["album_id as id", "position"])
          .where("user_id", "=", userId)
          .where("album_id", "in", ids)
          .execute()
      : await tdb()
          .selectFrom("folder_positions")
          .select(["folder_id as id", "position"])
          .where("user_id", "=", userId)
          .where("folder_id", "in", ids)
          .execute();
  return new Map(rows.map((r) => [r.id, r.position]));
}

/**
 * Order items by a mode. Manual: positioned items by position, then the rest
 * (e.g. albums added since the last move) oldest first, i.e. new ones at the end.
 */
export function sortItems<T extends SortableItem>(
  items: T[],
  mode: SortMode,
  positions: Map<string, number> = new Map(),
): T[] {
  const newest = (a: T, b: T) => b.created_at - a.created_at;
  const sorted = [...items];
  switch (mode) {
    case "name":
      return sorted.sort((a, b) => collator.compare(a.name, b.name) || newest(a, b));
    case "created":
      return sorted.sort(newest);
    case "modified":
      return sorted.sort((a, b) => b.modified_at - a.modified_at || newest(a, b));
    case "manual":
      return sorted.sort((a, b) => {
        const pa = positions.get(a.id);
        const pb = positions.get(b.id);
        if (pa !== undefined && pb !== undefined) return pa - pb || newest(a, b);
        if (pa !== undefined) return -1;
        if (pb !== undefined) return 1;
        return a.created_at - b.created_at;
      });
  }
}

async function writePositions(userId: string, kind: Kind, entries: [string, number][]) {
  if (entries.length === 0) return;
  const ids = entries.map(([id]) => id);
  await tdb()
    .transaction()
    .execute(async (trx) => {
      if (kind === "album") {
        await trx
          .deleteFrom("album_positions")
          .where("user_id", "=", userId)
          .where("album_id", "in", ids)
          .execute();
        await trx
          .insertInto("album_positions")
          .values(
            entries.map(([album_id, position]) => ({
              tenant_id: currentTenantId(),
              user_id: userId,
              album_id,
              position,
            })),
          )
          .execute();
      } else {
        await trx
          .deleteFrom("folder_positions")
          .where("user_id", "=", userId)
          .where("folder_id", "in", ids)
          .execute();
        await trx
          .insertInto("folder_positions")
          .values(
            entries.map(([folder_id, position]) => ({
              tenant_id: currentTenantId(),
              user_id: userId,
              folder_id,
              position,
            })),
          )
          .execute();
      }
    });
}

/**
 * Start manual order from what the user currently sees: number `ordered`
 * (the container's items in the old order), unless a manual order was saved
 * before, which then comes back.
 */
export async function seedManual(userId: string, kind: Kind, ordered: SortableItem[]) {
  const ids = ordered.map((i) => i.id);
  if ((await getPositions(userId, kind, ids)).size > 0) return;
  await writePositions(
    userId,
    kind,
    ordered.map((i, n) => [i.id, (n + 1) * GAP]),
  );
}

/**
 * Move `itemId` before `beforeId` (null: to the end) among `items`, the
 * container's albums or folders. Moving switches the container to manual
 * order for this user, starting from the order they currently see.
 *
 * A move writes one position (the midpoint of its new neighbours). More rows
 * are written only to switch to manual (numbering everything once), when the
 * new neighbours have no position yet (numbering the unpositioned tail), or
 * when a gap gets too small (renumbering).
 */
export async function moveItem(
  userId: string,
  folderId: string | null,
  kind: Kind,
  items: SortableItem[],
  itemId: string,
  beforeId: string | null,
): Promise<{ mode: SortMode }> {
  const mode = await getMode(userId, folderId);
  const positions = await getPositions(
    userId,
    kind,
    items.map((i) => i.id),
  );
  const current = sortItems(items, mode, positions);
  const item = current.find((i) => i.id === itemId);
  if (!item) throw new AppError(404, `${kind === "album" ? "Album" : "Folder"} not found here`);
  const rest = current.filter((i) => i.id !== itemId);
  const index = beforeId === null ? rest.length : rest.findIndex((i) => i.id === beforeId);
  if (index < 0) throw new AppError(404, "Target not found here");
  const order = [...rest.slice(0, index), item, ...rest.slice(index)];

  const renumber = () =>
    writePositions(
      userId,
      kind,
      order.map((i, n) => [i.id, (n + 1) * GAP]),
    );

  if (mode !== "manual") {
    await renumber();
    await setMode(userId, folderId, "manual");
    return { mode: "manual" };
  }

  // Unpositioned items form the tail; number them before placing next to them.
  const prev = order[index - 1];
  const next = order[index + 1];
  if ((prev && !positions.has(prev.id)) || (next && !positions.has(next.id))) {
    let last = Math.max(0, ...[...positions.values()]);
    const tail: [string, number][] = [];
    for (const i of order) {
      if (i.id !== itemId && !positions.has(i.id)) {
        last += GAP;
        tail.push([i.id, last]);
        positions.set(i.id, last);
      }
    }
    await writePositions(userId, kind, tail);
  }

  const before = prev ? positions.get(prev.id) : undefined;
  const after = next ? positions.get(next.id) : undefined;
  if (before !== undefined && after !== undefined && after - before < MIN_GAP) {
    await renumber();
    return { mode };
  }
  const position =
    before !== undefined && after !== undefined
      ? (before + after) / 2
      : before !== undefined
        ? before + GAP
        : after !== undefined
          ? after - GAP
          : GAP;
  await writePositions(userId, kind, [[itemId, position]]);
  return { mode };
}

/** Forget every user's manual position of an item that moved to another container. */
export async function dropPositions(kind: Kind, id: string): Promise<void> {
  if (kind === "album") {
    await tdb().deleteFrom("album_positions").where("album_id", "=", id).execute();
  } else {
    await tdb().deleteFrom("folder_positions").where("folder_id", "=", id).execute();
  }
}

/** Forget every user's sort mode for a folder that is being deleted. */
export async function dropModes(folderId: string): Promise<void> {
  await tdb().deleteFrom("folder_sort").where("folder_key", "=", folderId).execute();
}
