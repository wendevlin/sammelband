import type { Album, Folder, SortMode } from "../db/schema";
import { AppError, must } from "../lib/errors";
import { emit, topics } from "../lib/events";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { type AlbumWithCover, attachCovers, coverFilename } from "./album.service";
import type { SortableItem } from "./sort.service";
import * as sortService from "./sort.service";

export function listFolders(): Promise<Folder[]> {
  return tdb()
    .selectFrom("folders")
    .selectAll()
    .orderBy("parent_id", (ob) => ob.asc().nullsFirst())
    .orderBy("name")
    .execute();
}

export async function getFolder(id: string): Promise<Folder | null> {
  return (
    (await tdb().selectFrom("folders").selectAll().where("id", "=", id).executeTakeFirst()) ?? null
  );
}

export async function createFolder(input: {
  name: string;
  parentId: string | null;
  createdBy: string;
}): Promise<Folder> {
  if (!input.name.trim()) throw new AppError(400, "Folder name required");
  if (input.parentId && !(await getFolder(input.parentId))) {
    throw new AppError(404, "Parent folder not found");
  }
  const id = Bun.randomUUIDv7();
  await tdb()
    .insertInto("folders")
    .values({
      id,
      tenant_id: currentTenantId(),
      name: input.name.trim(),
      parent_id: input.parentId,
      created_by: input.createdBy,
      created_at: Date.now(),
    })
    .execute();
  const folder = must(await getFolder(id), "Folder");
  emit({ topic: topics.folderTree(), kind: "created", id, data: folder });
  if (folder.parent_id) {
    emit({ topic: topics.folder(folder.parent_id), kind: "updated" });
  }
  return folder;
}

export async function updateFolder(
  id: string,
  patch: { name?: string; parentId?: string | null },
): Promise<Folder> {
  const folder = await getFolder(id);
  if (!folder) throw new AppError(404, "Folder not found");

  if (patch.parentId !== undefined) {
    if (patch.parentId === id) throw new AppError(400, "Folder cannot be its own parent");
    if (patch.parentId && !(await getFolder(patch.parentId))) {
      throw new AppError(404, "Parent folder not found");
    }
    if (patch.parentId && (await isDescendant(patch.parentId, id))) {
      throw new AppError(400, "Cannot move folder into its own descendant");
    }
  }

  const name = patch.name?.trim() ?? folder.name;
  const parentId = patch.parentId === undefined ? folder.parent_id : patch.parentId;
  await tdb()
    .updateTable("folders")
    .set({ name, parent_id: parentId })
    .where("id", "=", id)
    .execute();
  if (parentId !== folder.parent_id) await sortService.dropPositions("folder", id);
  const updated = must(await getFolder(id), "Folder");
  emit({ topic: topics.folder(id), kind: "updated", id, data: updated });
  emit({ topic: topics.folderTree(), kind: "updated", id });
  if (folder.parent_id && folder.parent_id !== parentId) {
    emit({ topic: topics.folder(folder.parent_id), kind: "updated" });
  }
  if (parentId && parentId !== folder.parent_id) {
    emit({ topic: topics.folder(parentId), kind: "updated" });
  }
  return updated;
}

// Returns true if `candidateAncestorId` appears anywhere in the parent chain of `folderId`.
async function isDescendant(folderId: string, candidateAncestorId: string): Promise<boolean> {
  let current = await getFolder(folderId);
  while (current?.parent_id) {
    if (current.parent_id === candidateAncestorId) return true;
    current = await getFolder(current.parent_id);
  }
  return false;
}

export async function deleteFolder(id: string): Promise<void> {
  const folder = await getFolder(id);
  if (!folder) throw new AppError(404, "Folder not found");

  const albums = await tdb()
    .selectFrom("albums")
    .select("id")
    .where("folder_id", "=", id)
    .executeTakeFirst();
  if (albums) {
    throw new AppError(409, "Folder is not empty — move or delete albums first");
  }
  const subfolders = await tdb()
    .selectFrom("folders")
    .select("id")
    .where("parent_id", "=", id)
    .executeTakeFirst();
  if (subfolders) {
    throw new AppError(409, "Folder is not empty — move or delete sub-folders first");
  }

  await sortService.dropModes(id);
  await tdb().deleteFrom("folders").where("id", "=", id).execute();
  emit({ topic: topics.folder(id), kind: "deleted", id });
  emit({ topic: topics.folderTree(), kind: "deleted", id });
  if (folder.parent_id) {
    emit({ topic: topics.folder(folder.parent_id), kind: "updated" });
  }
}

/** A folder as a library tile: up to four album covers as a preview, plus counts. */
export type FolderTile = Folder & {
  covers: string[];
  album_count: number;
  folder_count: number;
  /** Latest change: its creation or an edit of an album directly inside. */
  modified_at: number;
};

const PREVIEW_COVERS = 4;

const albumItem = (a: Album): SortableItem => ({
  id: a.id,
  name: a.title,
  created_at: a.created_at,
  modified_at: a.updated_at,
});

/**
 * Library tiles for `folders`, in the given order. The preview shows the
 * covers of the folder's albums in the user's order for that folder, or, if it
 * holds only sub-folders, of the albums in those (one level deep, newest
 * first). Albums without any image are skipped.
 */
export async function withPreviews(folders: Folder[], userId: string): Promise<FolderTile[]> {
  if (folders.length === 0) return [];
  const ids = folders.map((f) => f.id);
  const children = await tdb()
    .selectFrom("folders")
    .select(["id", "parent_id"])
    .where("parent_id", "in", ids)
    .execute();
  const albums = await tdb()
    .selectFrom("albums")
    .selectAll()
    .where("folder_id", "in", [...ids, ...children.map((c) => c.id)])
    .orderBy("created_at", "desc")
    .execute();
  const modes = await sortService.getModes(userId, ids);
  const positions = await sortService.getPositions(
    userId,
    "album",
    albums.filter((a) => ids.includes(a.folder_id ?? "")).map((a) => a.id),
  );

  const albumsIn = (folderIds: string[]) =>
    albums.filter((a) => folderIds.includes(a.folder_id ?? ""));
  return Promise.all(
    folders.map(async (folder) => {
      const subfolders = children.filter((c) => c.parent_id === folder.id).map((c) => c.id);
      const own = albumsIn([folder.id]);
      const mode = modes.get(folder.id) ?? sortService.DEFAULT_MODE;
      const candidates =
        own.length > 0
          ? sortService
              .sortItems(own.map(albumItem), mode, positions)
              .map((i) => must(own.find((a) => a.id === i.id)))
          : albumsIn(subfolders);
      const covers: string[] = [];
      for (const album of candidates) {
        if (covers.length === PREVIEW_COVERS) break;
        const cover = await coverFilename(album);
        if (cover) covers.push(cover);
      }
      return {
        ...folder,
        covers,
        album_count: own.length,
        folder_count: subfolders.length,
        modified_at: Math.max(folder.created_at, ...own.map((a) => a.updated_at)),
      };
    }),
  );
}

export type Contents = {
  folders: FolderTile[];
  albums: AlbumWithCover[];
  sort: SortMode;
};

/** Folder + direct sub-folders (as tiles) + albums inside it, in the user's order. */
export async function getFolderContents(
  id: string,
  userId: string,
): Promise<Contents & { folder: Folder }> {
  const folder = await getFolder(id);
  if (!folder) throw new AppError(404, "Folder not found");
  return { folder, ...(await contentsOf(id, userId)) };
}

/** The top level of the library: root folders (as tiles) and albums outside any folder. */
export function getLibrary(userId: string): Promise<Contents> {
  return contentsOf(null, userId);
}

async function childrenOf(parentId: string | null) {
  const folders = await tdb()
    .selectFrom("folders")
    .selectAll()
    .where("parent_id", parentId === null ? "is" : "=", parentId)
    .execute();
  const albums = await tdb()
    .selectFrom("albums")
    .selectAll()
    .where("folder_id", parentId === null ? "is" : "=", parentId)
    .execute();
  return { folders, albums };
}

async function contentsOf(parentId: string | null, userId: string): Promise<Contents> {
  const { folders, albums } = await childrenOf(parentId);
  const sort = await sortService.getMode(userId, parentId);
  // Tiles first: their modified_at feeds the "modified" order.
  const tiles = await withPreviews(folders, userId);
  const folderPositions = await sortService.getPositions(
    userId,
    "folder",
    folders.map((f) => f.id),
  );
  const albumPositions = await sortService.getPositions(
    userId,
    "album",
    albums.map((a) => a.id),
  );
  const sortedAlbums = sortService
    .sortItems(albums.map(albumItem), sort, albumPositions)
    .map((i) => must(albums.find((a) => a.id === i.id)));
  return {
    folders: sortService.sortItems(tiles, sort, folderPositions),
    albums: await attachCovers(sortedAlbums),
    sort,
  };
}

async function requireContainer(folderId: string | null): Promise<void> {
  if (folderId !== null && !(await getFolder(folderId))) {
    throw new AppError(404, "Folder not found");
  }
}

/**
 * Set how the user sorts a folder's (or the root's) contents. Switching to
 * manual keeps the order shown until now (or restores an earlier manual one).
 */
export async function setSortMode(
  folderId: string | null,
  userId: string,
  mode: SortMode,
): Promise<void> {
  await requireContainer(folderId);
  const previous = await sortService.getMode(userId, folderId);
  if (mode === "manual" && previous !== "manual") {
    const { folders, albums } = await contentsOf(folderId, userId);
    await sortService.seedManual(userId, "folder", folders);
    await sortService.seedManual(userId, "album", albums.map(albumItem));
  }
  await sortService.setMode(userId, folderId, mode);
}

/**
 * Move an album or sub-folder of a container before `beforeId` (null: to the
 * end) in the user's manual order. Switches the container to manual order.
 */
export async function moveItem(
  folderId: string | null,
  userId: string,
  move: { kind: sortService.Kind; id: string; beforeId: string | null },
): Promise<{ sort: SortMode }> {
  await requireContainer(folderId);
  const { folders, albums } = await childrenOf(folderId);
  const items = move.kind === "album" ? albums.map(albumItem) : await withPreviews(folders, userId); // for modified_at, as the user sees them
  const { mode } = await sortService.moveItem(
    userId,
    folderId,
    move.kind,
    items,
    move.id,
    move.beforeId,
  );
  return { sort: mode };
}
