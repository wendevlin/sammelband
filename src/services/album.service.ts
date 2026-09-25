import { db } from "../db/client";
import type { Album, AlbumBlock, Photo } from "../db/schema";
import { AppError } from "../lib/errors";
import { emit, topics } from "../lib/events";
import * as imageService from "./image.service";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function getAlbum(id: string): Album | null {
  return db.query("SELECT * FROM albums WHERE id = ?").get(id) as Album | null;
}

export function getAlbumBySlug(slug: string, folderId: string | null): Album | null {
  if (folderId === null) {
    return db
      .query("SELECT * FROM albums WHERE slug = ? AND folder_id IS NULL")
      .get(slug) as Album | null;
  }
  return db
    .query("SELECT * FROM albums WHERE slug = ? AND folder_id = ?")
    .get(slug, folderId) as Album | null;
}

export function listAlbums(): Album[] {
  return db.query("SELECT * FROM albums ORDER BY created_at DESC").all() as Album[];
}

export function createAlbum(input: {
  title: string;
  description?: string | null;
  folderId: string | null;
  createdBy: string;
}): Album {
  if (!input.title.trim()) throw new AppError(400, "Title required");

  if (input.folderId) {
    const exists = db.query("SELECT 1 FROM folders WHERE id = ?").get(input.folderId);
    if (!exists) throw new AppError(404, "Folder not found");
  }

  const baseSlug = slugify(input.title) || "untitled";
  const slug = ensureUniqueSlug(baseSlug, input.folderId);

  const id = Bun.randomUUIDv7();
  const now = Date.now();
  db.run(
    `INSERT INTO albums
      (id, title, slug, description, folder_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.title.trim(),
      slug,
      input.description ?? null,
      input.folderId,
      input.createdBy,
      now,
      now,
    ],
  );
  const album = getAlbum(id)!;
  emit({ topic: topics.albumList(), kind: "created", id, data: album });
  emit({ topic: topics.album(id), kind: "created", id, data: album });
  if (album.folder_id) {
    emit({ topic: topics.folder(album.folder_id), kind: "updated" });
  }
  return album;
}

function ensureUniqueSlug(base: string, folderId: string | null): string {
  let candidate = base;
  let n = 2;
  while (getAlbumBySlug(candidate, folderId)) {
    candidate = `${base}-${n++}`;
  }
  return candidate;
}

export function updateAlbum(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    folderId?: string | null;
  },
): Album {
  const album = getAlbum(id);
  if (!album) throw new AppError(404, "Album not found");

  let newFolderId = album.folder_id;
  if (patch.folderId !== undefined) {
    if (patch.folderId && !db.query("SELECT 1 FROM folders WHERE id = ?").get(patch.folderId)) {
      throw new AppError(404, "Folder not found");
    }
    newFolderId = patch.folderId;
  }

  let newSlug = album.slug;
  if (patch.title || newFolderId !== album.folder_id) {
    const baseSlug = slugify(patch.title ?? album.title) || album.slug;
    // Only re-uniquify if base changed or we moved folder.
    if (baseSlug !== album.slug || newFolderId !== album.folder_id) {
      newSlug = ensureUniqueSlugExcluding(baseSlug, newFolderId, id);
    }
  }

  db.run(
    `UPDATE albums SET
       title = ?, slug = ?, description = ?, folder_id = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.title?.trim() ?? album.title,
      newSlug,
      patch.description !== undefined ? patch.description : album.description,
      newFolderId,
      Date.now(),
      id,
    ],
  );
  const updated = getAlbum(id)!;
  emit({ topic: topics.album(id), kind: "updated", id, data: updated });
  emit({ topic: topics.albumList(), kind: "updated", id });
  if (album.folder_id && album.folder_id !== updated.folder_id) {
    emit({ topic: topics.folder(album.folder_id), kind: "updated" });
  }
  if (updated.folder_id && updated.folder_id !== album.folder_id) {
    emit({ topic: topics.folder(updated.folder_id), kind: "updated" });
  }
  return updated;
}

function ensureUniqueSlugExcluding(
  base: string,
  folderId: string | null,
  excludeId: string,
): string {
  let candidate = base;
  let n = 2;
  while (true) {
    const existing = getAlbumBySlug(candidate, folderId);
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${n++}`;
  }
}

export function setCover(albumId: string, photoId: string | null): Album {
  const album = getAlbum(albumId);
  if (!album) throw new AppError(404, "Album not found");
  if (photoId !== null) {
    const photo = db
      .query("SELECT 1 FROM photos WHERE id = ? AND album_id = ?")
      .get(photoId, albumId);
    if (!photo) throw new AppError(404, "Photo not found in album");
  }
  db.run("UPDATE albums SET cover_photo_id = ?, updated_at = ? WHERE id = ?", [
    photoId,
    Date.now(),
    albumId,
  ]);
  const updated = getAlbum(albumId)!;
  emit({ topic: topics.album(albumId), kind: "updated", id: albumId, data: updated });
  emit({ topic: topics.albumList(), kind: "updated", id: albumId });
  return updated;
}

export type AlbumWithCover = Album & { cover_filename: string | null };

// Cover image filename: the explicitly chosen cover, else the album's first
// image (first gallery in block order, first photo by sort_order), else null.
export function coverFilename(album: Album): string | null {
  if (album.cover_photo_id) {
    const row = db
      .query(
        `SELECT i.filename FROM image_files i
         JOIN photos p ON p.image_file_id = i.id
         WHERE p.id = ?`,
      )
      .get(album.cover_photo_id) as { filename: string } | null;
    if (row) return row.filename;
  }
  const first = db
    .query(
      `SELECT i.filename
       FROM photos p
       JOIN image_files i ON i.id = p.image_file_id
       JOIN album_blocks b ON b.id = p.block_id
       WHERE p.album_id = ?
       ORDER BY b.sort_order ASC, p.sort_order ASC
       LIMIT 1`,
    )
    .get(album.id) as { filename: string } | null;
  return first?.filename ?? null;
}

export function attachCovers(albums: Album[]): AlbumWithCover[] {
  return albums.map((a) => ({ ...a, cover_filename: coverFilename(a) }));
}

export function deleteAlbum(id: string): void {
  const album = getAlbum(id);
  if (!album) throw new AppError(404, "Album not found");
  // Remove all photos from disk + variant cache first (dedup-aware); blocks +
  // share_links then cascade via FK ON DELETE CASCADE when the album row is gone.
  imageService.deletePhotosByAlbum(id);
  db.run("DELETE FROM albums WHERE id = ?", [id]);
  emit({ topic: topics.album(id), kind: "deleted", id });
  emit({ topic: topics.albumList(), kind: "deleted", id });
  if (album.folder_id) {
    emit({ topic: topics.folder(album.folder_id), kind: "updated" });
  }
}

export type PhotoWithImage = Photo & {
  filename: string;
  width: number;
  height: number;
  placeholder: string;
};

/** Album + ordered blocks + photos (with image metadata + placeholder). */
export function getAlbumDetail(albumId: string): {
  album: Album;
  blocks: AlbumBlock[];
  photos: PhotoWithImage[];
} {
  const album = getAlbum(albumId);
  if (!album) throw new AppError(404, "Album not found");
  const blocks = db
    .query("SELECT * FROM album_blocks WHERE album_id = ? ORDER BY sort_order ASC")
    .all(albumId) as AlbumBlock[];
  const photos = db
    .query(
      `SELECT p.*, i.filename, i.width, i.height, i.placeholder
       FROM photos p JOIN image_files i ON i.id = p.image_file_id
       WHERE p.album_id = ?
       ORDER BY p.sort_order`,
    )
    .all(albumId) as PhotoWithImage[];
  return { album, blocks, photos };
}
