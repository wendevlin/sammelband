import type { Folder } from "../db/schema";
import { AppError, must } from "../lib/errors";
import { emit, topics } from "../lib/events";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { type AlbumWithCover, attachCovers, coverFilename } from "./album.service";

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
};

const PREVIEW_COVERS = 4;

/**
 * Preview covers for folder tiles: the covers of the albums in the folder, or,
 * if it holds only sub-folders, of the albums in those (one level deep).
 * Albums without any image are skipped.
 */
export async function withPreviews(folders: Folder[]): Promise<FolderTile[]> {
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

  const albumsIn = (folderIds: string[]) =>
    albums.filter((a) => folderIds.includes(a.folder_id ?? ""));
  return Promise.all(
    folders.map(async (folder) => {
      const subfolders = children.filter((c) => c.parent_id === folder.id).map((c) => c.id);
      const own = albumsIn([folder.id]);
      const candidates = own.length > 0 ? own : albumsIn(subfolders);
      const covers: string[] = [];
      for (const album of candidates) {
        if (covers.length === PREVIEW_COVERS) break;
        const cover = await coverFilename(album);
        if (cover) covers.push(cover);
      }
      return { ...folder, covers, album_count: own.length, folder_count: subfolders.length };
    }),
  );
}

/** Folder + direct sub-folders (as tiles) + albums inside it. */
export async function getFolderContents(id: string): Promise<{
  folder: Folder;
  folders: FolderTile[];
  albums: AlbumWithCover[];
}> {
  const folder = await getFolder(id);
  if (!folder) throw new AppError(404, "Folder not found");
  return { folder, ...(await contentsOf(id)) };
}

/** The top level of the library: root folders (as tiles) and albums outside any folder. */
export function getLibrary(): Promise<{ folders: FolderTile[]; albums: AlbumWithCover[] }> {
  return contentsOf(null);
}

async function contentsOf(parentId: string | null) {
  const folders = await tdb()
    .selectFrom("folders")
    .selectAll()
    .where("parent_id", parentId === null ? "is" : "=", parentId)
    .orderBy("name")
    .execute();
  const albums = await tdb()
    .selectFrom("albums")
    .selectAll()
    .where("folder_id", parentId === null ? "is" : "=", parentId)
    .orderBy("created_at", "desc")
    .execute();
  return { folders: await withPreviews(folders), albums: await attachCovers(albums) };
}
