import { db } from "../db/client";
import type { Album, Folder } from "../db/schema";

/**
 * All resource-visibility checks for non-admin users.
 *
 * Inheritance: a folder_access grant on folder F implies access to every album
 * in F or any descendant of F, and to every sub-folder of F.
 * Access is enforced via a recursive CTE that walks folders.parent_id upward.
 */

// Albums visible to a user (admin sees everything; non-admin via grants).
export function getAccessibleAlbums(userId: string): Album[] {
  return db
    .query(
      `
      WITH RECURSIVE folder_chain(id, ancestor_id) AS (
        SELECT id, parent_id FROM folders
        UNION ALL
        SELECT fc.id, f.parent_id
        FROM folder_chain fc
        JOIN folders f ON f.id = fc.ancestor_id
        WHERE fc.ancestor_id IS NOT NULL
      )
      SELECT DISTINCT a.*
      FROM albums a
      LEFT JOIN album_access aa
             ON aa.album_id = a.id
            AND aa.user_id  = ?1
      LEFT JOIN folder_chain fc
             ON fc.id = a.folder_id
      LEFT JOIN folder_access fa
             ON (fa.folder_id = a.folder_id OR fa.folder_id = fc.ancestor_id)
            AND fa.user_id = ?1
      WHERE aa.user_id IS NOT NULL OR fa.user_id IS NOT NULL
      ORDER BY a.created_at DESC
      `,
    )
    .all(userId) as Album[];
}

export function canSeeAlbum(userId: string, albumId: string): boolean {
  const row = db
    .query(
      `
      WITH RECURSIVE folder_chain(id, ancestor_id) AS (
        SELECT id, parent_id FROM folders
        UNION ALL
        SELECT fc.id, f.parent_id
        FROM folder_chain fc
        JOIN folders f ON f.id = fc.ancestor_id
        WHERE fc.ancestor_id IS NOT NULL
      )
      SELECT 1 AS ok
      FROM albums a
      LEFT JOIN album_access aa
             ON aa.album_id = a.id AND aa.user_id = ?1
      LEFT JOIN folder_chain fc
             ON fc.id = a.folder_id
      LEFT JOIN folder_access fa
             ON (fa.folder_id = a.folder_id OR fa.folder_id = fc.ancestor_id)
            AND fa.user_id = ?1
      WHERE a.id = ?2
        AND (aa.user_id IS NOT NULL OR fa.user_id IS NOT NULL)
      LIMIT 1
      `,
    )
    .get(userId, albumId);
  return row !== null;
}

export function canSeeFolder(userId: string, folderId: string): boolean {
  // A user can see a folder if they have folder_access on it or any ancestor,
  // OR if any album they can see lives in it (don't need that yet — admin UI
  // doesn't expose folders that exist solely as containers without grants).
  const row = db
    .query(
      `
      WITH RECURSIVE chain(id, parent_id) AS (
        SELECT id, parent_id FROM folders WHERE id = ?2
        UNION ALL
        SELECT f.id, f.parent_id
        FROM chain c
        JOIN folders f ON f.id = c.parent_id
      )
      SELECT 1 AS ok
      FROM chain c
      JOIN folder_access fa ON fa.folder_id = c.id AND fa.user_id = ?1
      LIMIT 1
      `,
    )
    .get(userId, folderId);
  return row !== null;
}

// Direct sub-folders + albums inside a folder, with no access filtering.
// Callers must have already authorized the principal (admin, or canSeeFolder).
export function listFolderContents(folderId: string): { folders: Folder[]; albums: Album[] } {
  const folders = db
    .query("SELECT * FROM folders WHERE parent_id = ? ORDER BY name")
    .all(folderId) as Folder[];
  const albums = db
    .query("SELECT * FROM albums WHERE folder_id = ? ORDER BY created_at DESC")
    .all(folderId) as Album[];
  return { folders, albums };
}

export function folderExists(folderId: string): boolean {
  return db.query("SELECT 1 FROM folders WHERE id = ?").get(folderId) !== null;
}

// Sub-folders + accessible albums inside a given folder, filtered for a user.
export function getFolderContents(
  userId: string,
  folderId: string,
): { folders: Folder[]; albums: Album[] } | null {
  if (!canSeeFolder(userId, folderId)) return null;
  return listFolderContents(folderId);
}

// Every album / folder, for admins (who see everything). Same shape and order
// as the grant-filtered variants so the frontend renders them identically.
export function getAllAlbums(): Album[] {
  return db.query("SELECT * FROM albums ORDER BY created_at DESC").all() as Album[];
}

export function getAllFolders(): Folder[] {
  return db.query("SELECT * FROM folders ORDER BY parent_id, name").all() as Folder[];
}

// Folder tree the user can see: roots + descendants reachable via grants.
export function getVisibleFolderTree(userId: string): Folder[] {
  return db
    .query(
      `
      WITH RECURSIVE descendants(id) AS (
        SELECT folder_id AS id FROM folder_access WHERE user_id = ?
        UNION
        SELECT f.id
        FROM folders f
        JOIN descendants d ON f.parent_id = d.id
      )
      SELECT f.*
      FROM folders f
      JOIN descendants d ON d.id = f.id
      ORDER BY f.parent_id, f.name
      `,
    )
    .all(userId) as Folder[];
}
