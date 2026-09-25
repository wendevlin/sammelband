import { db } from "../db/client";
import { AppError } from "../lib/errors";
import { emit } from "../lib/events";

type Grant = {
  user_id: string;
  granted_by: string;
  granted_at: number;
  email?: string;
  name?: string | null;
};

function ensureUser(userId: string): void {
  const u = db.query("SELECT 1 FROM user WHERE id = ?").get(userId);
  if (!u) throw new AppError(404, "User not found");
}

export function grantAlbumAccess(albumId: string, userId: string, grantedBy: string): void {
  if (!db.query("SELECT 1 FROM albums WHERE id = ?").get(albumId)) {
    throw new AppError(404, "Album not found");
  }
  ensureUser(userId);
  db.run(
    `INSERT OR IGNORE INTO album_access (album_id, user_id, granted_by, granted_at)
     VALUES (?, ?, ?, ?)`,
    [albumId, userId, grantedBy, Date.now()],
  );
  emit({ topic: `access:album:${albumId}`, kind: "created", id: userId });
}

export function revokeAlbumAccess(albumId: string, userId: string): void {
  db.run("DELETE FROM album_access WHERE album_id = ? AND user_id = ?", [albumId, userId]);
  emit({ topic: `access:album:${albumId}`, kind: "deleted", id: userId });
}

export function listAlbumGrants(albumId: string): Grant[] {
  return db
    .query(
      `SELECT aa.user_id, aa.granted_by, aa.granted_at, u.email, u.name
       FROM album_access aa JOIN user u ON u.id = aa.user_id
       WHERE aa.album_id = ?
       ORDER BY aa.granted_at`,
    )
    .all(albumId) as Grant[];
}

export function grantFolderAccess(folderId: string, userId: string, grantedBy: string): void {
  if (!db.query("SELECT 1 FROM folders WHERE id = ?").get(folderId)) {
    throw new AppError(404, "Folder not found");
  }
  ensureUser(userId);
  db.run(
    `INSERT OR IGNORE INTO folder_access (folder_id, user_id, granted_by, granted_at)
     VALUES (?, ?, ?, ?)`,
    [folderId, userId, grantedBy, Date.now()],
  );
  emit({ topic: `access:folder:${folderId}`, kind: "created", id: userId });
}

export function revokeFolderAccess(folderId: string, userId: string): void {
  db.run("DELETE FROM folder_access WHERE folder_id = ? AND user_id = ?", [folderId, userId]);
  emit({ topic: `access:folder:${folderId}`, kind: "deleted", id: userId });
}

export function listFolderGrants(folderId: string): Grant[] {
  return db
    .query(
      `SELECT fa.user_id, fa.granted_by, fa.granted_at, u.email, u.name
       FROM folder_access fa JOIN user u ON u.id = fa.user_id
       WHERE fa.folder_id = ?
       ORDER BY fa.granted_at`,
    )
    .all(folderId) as Grant[];
}
