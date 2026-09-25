import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { config, isSrcsetWidth, SRCSET_WIDTHS, type SrcsetWidth } from "../config";
import { db } from "../db/client";
import type { ImageFile, Photo } from "../db/schema";
import { AppError } from "../lib/errors";
import { emit, topics } from "../lib/events";

const ORIGINALS_DIR = join(config.UPLOADS_PATH, "originals");
const VARIANTS_DIR = join(config.UPLOADS_PATH, "variants");

export type UploadedPhoto = {
  photo: Photo;
  imageFile: ImageFile;
  deduplicated: boolean;
};

export async function uploadPhoto(
  file: File,
  blockId: string,
  uploaderId: string,
): Promise<UploadedPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new AppError(400, "Only image uploads are allowed");
  }
  // Photos belong to a gallery block; the album is derived from it.
  const block = db.query("SELECT album_id, type FROM album_blocks WHERE id = ?").get(blockId) as {
    album_id: string;
    type: string;
  } | null;
  if (!block) throw new AppError(404, "Gallery block not found");
  if (block.type !== "gallery") throw new AppError(400, "Block is not a gallery");
  const albumId = block.album_id;

  const buf = Buffer.from(await file.arrayBuffer());

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buf);
  const contentHash = hasher.digest("hex");

  let imageFile = db
    .query("SELECT * FROM image_files WHERE content_hash = ?")
    .get(contentHash) as ImageFile | null;

  let deduplicated = false;

  if (!imageFile) {
    const filename = `${Bun.randomUUIDv7()}.bin`;
    const originalPath = join(ORIGINALS_DIR, filename);
    await Bun.write(originalPath, buf);

    const { width, height } = await new Bun.Image(buf, {
      autoOrient: true,
    }).metadata();
    if (!width || !height) throw new AppError(400, "Unable to read image dimensions");

    const placeholder = await new Bun.Image(buf).placeholder();

    const imageFileId = Bun.randomUUIDv7();
    db.run(
      `INSERT INTO image_files
         (id, content_hash, filename, original_path, width, height, file_size, placeholder, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        imageFileId,
        contentHash,
        filename,
        originalPath,
        width,
        height,
        buf.byteLength,
        placeholder,
        Date.now(),
      ],
    );
    imageFile = db.query("SELECT * FROM image_files WHERE id = ?").get(imageFileId) as ImageFile;
  } else {
    deduplicated = true;
  }

  const { next } = db
    .query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM photos WHERE block_id = ?")
    .get(blockId) as { next: number };

  const photoId = Bun.randomUUIDv7();
  db.run(
    `INSERT INTO photos (id, album_id, block_id, sort_order, image_file_id, uploaded_by, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [photoId, albumId, blockId, next, imageFile.id, uploaderId, Date.now()],
  );
  const photo = db.query("SELECT * FROM photos WHERE id = ?").get(photoId) as Photo;
  emit({ topic: topics.album(albumId), kind: "updated", id: albumId });
  emit({
    topic: topics.photoPool(albumId),
    kind: "created",
    id: photo.id,
    data: { photo, deduplicated },
  });
  emit({ topic: topics.storageStats(), kind: "updated" });
  return { photo, imageFile, deduplicated };
}

export function updateCaption(photoId: string, caption: string | null): Photo {
  const photo = db.query("SELECT * FROM photos WHERE id = ?").get(photoId) as Photo | null;
  if (!photo) throw new AppError(404, "Photo not found");
  db.run("UPDATE photos SET caption = ? WHERE id = ?", [caption, photoId]);
  const updated = db.query("SELECT * FROM photos WHERE id = ?").get(photoId) as Photo;
  emit({ topic: topics.album(updated.album_id), kind: "updated", id: updated.album_id });
  emit({ topic: topics.photoPool(updated.album_id), kind: "updated", id: photoId });
  return updated;
}

// Remove an image_file's original AND every cached variant from disk.
// Best-effort: file removal can fail (already gone, permissions); DB stays consistent.
function removeImageFileFromDisk(file: ImageFile): void {
  const paths = [file.original_path];
  for (const w of SRCSET_WIDTHS) {
    for (const fmt of ["webp", "jpeg"] as const) {
      paths.push(join(VARIANTS_DIR, `${file.filename}_${w}.${fmt}`));
    }
  }
  for (const p of paths) {
    try {
      rmSync(p, { force: true });
    } catch {
      /* ignore */
    }
  }
}

// Drop the image_file (and its on-disk files) iff no photo references it anymore.
// Must run inside a transaction after the owning photo row(s) are deleted.
function dropImageFileIfUnused(imageFileId: string): void {
  const { n } = db
    .query("SELECT COUNT(*) AS n FROM photos WHERE image_file_id = ?")
    .get(imageFileId) as { n: number };
  if (n > 0) return;
  const file = db
    .query("SELECT * FROM image_files WHERE id = ?")
    .get(imageFileId) as ImageFile | null;
  db.run("DELETE FROM image_files WHERE id = ?", [imageFileId]);
  if (file) removeImageFileFromDisk(file);
}

export function deletePhoto(photoId: string): void {
  const photo = db.query("SELECT * FROM photos WHERE id = ?").get(photoId) as Photo | null;
  if (!photo) throw new AppError(404, "Photo not found");

  db.transaction(() => {
    db.run("DELETE FROM photos WHERE id = ?", [photoId]);
    dropImageFileIfUnused(photo.image_file_id);
  })();
  emit({ topic: topics.album(photo.album_id), kind: "updated", id: photo.album_id });
  emit({ topic: topics.photoPool(photo.album_id), kind: "deleted", id: photoId });
  emit({ topic: topics.storageStats(), kind: "updated" });
}

// Delete every photo belonging to the given blocks, cleaning disk/cache (dedup-aware).
// Used when a gallery block (or a group containing galleries) is deleted.
export function deletePhotosByBlocks(blockIds: string[]): void {
  if (blockIds.length === 0) return;
  const placeholders = blockIds.map(() => "?").join(", ");
  const photos = db
    .query(`SELECT * FROM photos WHERE block_id IN (${placeholders})`)
    .all(...blockIds) as Photo[];
  if (photos.length === 0) return;

  db.transaction(() => {
    for (const p of photos) {
      db.run("DELETE FROM photos WHERE id = ?", [p.id]);
      dropImageFileIfUnused(p.image_file_id);
    }
  })();

  for (const albumId of new Set(photos.map((p) => p.album_id))) {
    emit({ topic: topics.album(albumId), kind: "updated", id: albumId });
  }
  emit({ topic: topics.storageStats(), kind: "updated" });
}

// Delete every photo of an album, cleaning disk/cache (dedup-aware). Catches
// orphans too (block_id NULL). Used when an album is deleted.
export function deletePhotosByAlbum(albumId: string): void {
  const photos = db.query("SELECT * FROM photos WHERE album_id = ?").all(albumId) as Photo[];
  if (photos.length === 0) return;
  db.transaction(() => {
    for (const p of photos) {
      db.run("DELETE FROM photos WHERE id = ?", [p.id]);
      dropImageFileIfUnused(p.image_file_id);
    }
  })();
  emit({ topic: topics.storageStats(), kind: "updated" });
}

export function reorderPhotos(blockId: string, order: { id: string; sortOrder: number }[]): void {
  db.transaction(() => {
    for (const e of order) {
      db.run("UPDATE photos SET sort_order = ? WHERE id = ? AND block_id = ?", [
        e.sortOrder,
        e.id,
        blockId,
      ]);
    }
  })();
  const block = db.query("SELECT album_id FROM album_blocks WHERE id = ?").get(blockId) as {
    album_id: string;
  } | null;
  if (block) emit({ topic: topics.album(block.album_id), kind: "updated", id: block.album_id });
}

// Stored filenames are "<uuid>.bin". Anything else (e.g. "../") is rejected
// before it reaches the filesystem.
const FILENAME_RE = /^[0-9a-f-]{36}\.bin$/;

function assertFilename(filename: string): void {
  if (!FILENAME_RE.test(filename)) throw new AppError(404, "Image not found");
}

export async function serveVariant(
  filename: string,
  width: number,
  format: "webp" | "jpeg" = "webp",
): Promise<Response> {
  assertFilename(filename);
  if (!isSrcsetWidth(width)) {
    throw new AppError(400, "Unsupported width");
  }
  const variantPath = join(VARIANTS_DIR, `${filename}_${width}.${format}`);
  const cached = Bun.file(variantPath);
  if (await cached.exists()) {
    return new Response(cached, {
      headers: {
        "Content-Type": `image/${format}`,
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  const originalPath = join(ORIGINALS_DIR, filename);
  if (!existsSync(originalPath)) {
    throw new AppError(404, "Image not found");
  }

  const pipeline = new Bun.Image(originalPath).resize(width as SrcsetWidth);
  const output =
    format === "webp"
      ? await pipeline.webp({ quality: 80 }).bytes()
      : await pipeline.jpeg({ quality: 85 }).bytes();

  await Bun.write(variantPath, output);

  return new Response(output as BodyInit, {
    headers: {
      "Content-Type": `image/${format}`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

export async function serveOriginal(filename: string): Promise<Response> {
  assertFilename(filename);
  const file = Bun.file(join(ORIGINALS_DIR, filename));
  if (!(await file.exists())) throw new AppError(404, "Image not found");
  const row = db.query("SELECT 1 FROM image_files WHERE filename = ?").get(filename);
  if (!row) throw new AppError(404, "Image not found");
  return new Response(file, {
    headers: { "Cache-Control": "private, max-age=31536000, immutable" },
  });
}

export function originalSize(filename: string): number {
  return statSync(join(ORIGINALS_DIR, filename)).size;
}
