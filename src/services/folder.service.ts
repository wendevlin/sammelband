import { db } from "../db/client";
import type { Album, Folder } from "../db/schema";
import { AppError } from "../lib/errors";
import { emit, topics } from "../lib/events";

export function listFolders(): Folder[] {
  return db.query("SELECT * FROM folders ORDER BY parent_id, name").all() as Folder[];
}

export function getFolder(id: string): Folder | null {
  return db.query("SELECT * FROM folders WHERE id = ?").get(id) as Folder | null;
}

export function createFolder(input: {
  name: string;
  parentId: string | null;
  createdBy: string;
}): Folder {
  if (!input.name.trim()) throw new AppError(400, "Folder name required");
  if (input.parentId && !getFolder(input.parentId)) {
    throw new AppError(404, "Parent folder not found");
  }
  const id = Bun.randomUUIDv7();
  const now = Date.now();
  db.run(
    "INSERT INTO folders (id, name, parent_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, input.name.trim(), input.parentId, input.createdBy, now],
  );
  const folder = getFolder(id)!;
  emit({ topic: topics.folderTree(), kind: "created", id, data: folder });
  if (folder.parent_id) {
    emit({ topic: topics.folder(folder.parent_id), kind: "updated" });
  }
  return folder;
}

export function updateFolder(
  id: string,
  patch: { name?: string; parentId?: string | null },
): Folder {
  const folder = getFolder(id);
  if (!folder) throw new AppError(404, "Folder not found");

  if (patch.parentId !== undefined) {
    if (patch.parentId === id) throw new AppError(400, "Folder cannot be its own parent");
    if (patch.parentId && !getFolder(patch.parentId)) {
      throw new AppError(404, "Parent folder not found");
    }
    if (patch.parentId && isDescendant(patch.parentId, id)) {
      throw new AppError(400, "Cannot move folder into its own descendant");
    }
  }

  const name = patch.name?.trim() ?? folder.name;
  const parentId = patch.parentId === undefined ? folder.parent_id : patch.parentId;
  db.run("UPDATE folders SET name = ?, parent_id = ? WHERE id = ?", [name, parentId, id]);
  const updated = getFolder(id)!;
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
function isDescendant(folderId: string, candidateAncestorId: string): boolean {
  let current = getFolder(folderId);
  while (current?.parent_id) {
    if (current.parent_id === candidateAncestorId) return true;
    current = getFolder(current.parent_id);
  }
  return false;
}

export function deleteFolder(id: string): void {
  const folder = getFolder(id);
  if (!folder) throw new AppError(404, "Folder not found");

  const albumCount = (
    db.query("SELECT COUNT(*) AS n FROM albums WHERE folder_id = ?").get(id) as {
      n: number;
    }
  ).n;
  if (albumCount > 0) {
    throw new AppError(409, "Folder is not empty — move or delete albums first");
  }

  const subfolders = (
    db.query("SELECT COUNT(*) AS n FROM folders WHERE parent_id = ?").get(id) as { n: number }
  ).n;
  if (subfolders > 0) {
    throw new AppError(409, "Folder is not empty — move or delete sub-folders first");
  }

  db.run("DELETE FROM folders WHERE id = ?", [id]);
  emit({ topic: topics.folder(id), kind: "deleted", id });
  emit({ topic: topics.folderTree(), kind: "deleted", id });
  if (folder.parent_id) {
    emit({ topic: topics.folder(folder.parent_id), kind: "updated" });
  }
}

/** Folder + direct sub-folders + albums inside it. */
export function getFolderContents(id: string): {
  folder: Folder;
  folders: Folder[];
  albums: Album[];
} {
  const folder = getFolder(id);
  if (!folder) throw new AppError(404, "Folder not found");
  const folders = db
    .query("SELECT * FROM folders WHERE parent_id = ? ORDER BY name")
    .all(id) as Folder[];
  const albums = db
    .query("SELECT * FROM albums WHERE folder_id = ? ORDER BY created_at DESC")
    .all(id) as Album[];
  return { folder, folders, albums };
}
