import type { Album, Folder } from "../db/schema";
import { AppError, must } from "../lib/errors";
import { emit, topics } from "../lib/events";
import { currentTenantId, tdb } from "../lib/tenant-context";

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

/** Folder + direct sub-folders + albums inside it. */
export async function getFolderContents(id: string): Promise<{
  folder: Folder;
  folders: Folder[];
  albums: Album[];
}> {
  const folder = await getFolder(id);
  if (!folder) throw new AppError(404, "Folder not found");
  const folders = await tdb()
    .selectFrom("folders")
    .selectAll()
    .where("parent_id", "=", id)
    .orderBy("name")
    .execute();
  const albums = await tdb()
    .selectFrom("albums")
    .selectAll()
    .where("folder_id", "=", id)
    .orderBy("created_at", "desc")
    .execute();
  return { folder, folders, albums };
}
