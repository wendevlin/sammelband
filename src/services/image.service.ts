import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { config, isSrcsetWidth, SRCSET_WIDTHS, type SrcsetWidth } from "../config";
import { db } from "../db/client";
import type { Album, ImageFile, Photo } from "../db/schema";
import { AppError, must } from "../lib/errors";
import { emit, emitAlbumPatch, type PhotoWithImage, topics } from "../lib/events";

const ORIGINALS_DIR = join(config.UPLOADS_PATH, "originals");
const VARIANTS_DIR = join(config.UPLOADS_PATH, "variants");

export type UploadedPhoto = {
  photo: Photo;
  imageFile: ImageFile;
  deduplicated: boolean;
};

/** Photos joined with their image metadata, ordered by sort_order. */
export function photosWithImage(filter: {
  albumId?: string;
  blockId?: string;
  ids?: string[];
}): Promise<PhotoWithImage[]> {
  let q = db
    .selectFrom("photos as p")
    .innerJoin("image_files as i", "i.id", "p.image_file_id")
    .selectAll("p")
    .select(["i.filename", "i.width", "i.height", "i.placeholder"])
    .orderBy("p.sort_order");
  if (filter.albumId) q = q.where("p.album_id", "=", filter.albumId);
  if (filter.blockId) q = q.where("p.block_id", "=", filter.blockId);
  if (filter.ids) q = q.where("p.id", "in", filter.ids);
  return q.execute();
}

const photoWithImage = (id: string) => photosWithImage({ ids: [id] });

async function getPhoto(id: string): Promise<Photo | null> {
  return (
    (await db.selectFrom("photos").selectAll().where("id", "=", id).executeTakeFirst()) ?? null
  );
}

async function getAlbumRow(id: string): Promise<Album> {
  return db.selectFrom("albums").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function uploadPhoto(
  file: File,
  blockId: string,
  uploaderId: string,
): Promise<UploadedPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new AppError(400, "Only image uploads are allowed");
  }
  // Photos belong to a gallery block; the album is derived from it.
  const block = await db
    .selectFrom("album_blocks")
    .select(["album_id", "type"])
    .where("id", "=", blockId)
    .executeTakeFirst();
  if (!block) throw new AppError(404, "Gallery block not found");
  if (block.type !== "gallery") throw new AppError(400, "Block is not a gallery");
  const albumId = block.album_id;

  const buf = Buffer.from(await file.arrayBuffer());

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buf);
  const contentHash = hasher.digest("hex");

  let imageFile = await db
    .selectFrom("image_files")
    .selectAll()
    .where("content_hash", "=", contentHash)
    .executeTakeFirst();

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

    imageFile = {
      id: Bun.randomUUIDv7(),
      content_hash: contentHash,
      filename,
      original_path: originalPath,
      width,
      height,
      file_size: buf.byteLength,
      placeholder,
      created_at: Date.now(),
    };
    await db.insertInto("image_files").values(imageFile).execute();
  } else {
    deduplicated = true;
  }

  const { max } = await db
    .selectFrom("photos")
    .select((eb) => eb.fn.max("sort_order").as("max"))
    .where("block_id", "=", blockId)
    .executeTakeFirstOrThrow();

  const photo: Photo = {
    id: Bun.randomUUIDv7(),
    album_id: albumId,
    block_id: blockId,
    sort_order: (max ?? 0) + 1,
    image_file_id: imageFile.id,
    caption: null,
    uploaded_by: uploaderId,
    uploaded_at: Date.now(),
  };
  await db.insertInto("photos").values(photo).execute();
  // One small event per photo, so other viewers see a batch arrive one by one.
  emitAlbumPatch(albumId, { photos: await photoWithImage(photo.id) });
  emit({
    topic: topics.photoPool(albumId),
    kind: "created",
    id: photo.id,
    data: { photo, deduplicated },
  });
  emit({ topic: topics.storageStats(), kind: "updated" });
  return { photo, imageFile, deduplicated };
}

export async function updateCaption(photoId: string, caption: string | null): Promise<Photo> {
  if (!(await getPhoto(photoId))) throw new AppError(404, "Photo not found");
  await db.updateTable("photos").set({ caption }).where("id", "=", photoId).execute();
  const updated = must(await getPhoto(photoId), "Photo");
  emitAlbumPatch(updated.album_id, { photos: await photoWithImage(photoId) });
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

/**
 * Delete photo rows and every image_file (plus its files on disk) that no photo
 * references anymore. Runs in one transaction; `trx` must be used for every
 * query inside it (SQLite has a single connection).
 */
async function deletePhotoRows(photos: Photo[]): Promise<void> {
  if (photos.length === 0) return;
  const unused = await db.transaction().execute(async (trx) => {
    await trx
      .deleteFrom("photos")
      .where(
        "id",
        "in",
        photos.map((p) => p.id),
      )
      .execute();
    const imageFileIds = [...new Set(photos.map((p) => p.image_file_id))];
    const stillUsed = new Set(
      (
        await trx
          .selectFrom("photos")
          .select("image_file_id")
          .where("image_file_id", "in", imageFileIds)
          .execute()
      ).map((r) => r.image_file_id),
    );
    const unusedIds = imageFileIds.filter((id) => !stillUsed.has(id));
    if (unusedIds.length === 0) return [];
    return trx.deleteFrom("image_files").where("id", "in", unusedIds).returningAll().execute();
  });
  // Only touch the disk once the rows are gone for good.
  for (const file of unused) removeImageFileFromDisk(file);
}

export async function deletePhoto(photoId: string): Promise<void> {
  const photo = await getPhoto(photoId);
  if (!photo) throw new AppError(404, "Photo not found");

  await deletePhotoRows([photo]);
  // A trigger clears the cover if this photo was it, so resend the album row.
  const album = await getAlbumRow(photo.album_id);
  emitAlbumPatch(photo.album_id, { album, removedPhotos: [photoId] });
  emit({ topic: topics.photoPool(photo.album_id), kind: "deleted", id: photoId });
  emit({ topic: topics.storageStats(), kind: "updated" });
}

// Delete every photo belonging to the given blocks, cleaning disk/cache (dedup-aware).
// Used when a gallery block (or a group containing galleries) is deleted.
// Returns the deleted photo ids; the caller emits the album change.
export async function deletePhotosByBlocks(blockIds: string[]): Promise<string[]> {
  if (blockIds.length === 0) return [];
  const photos = await db
    .selectFrom("photos")
    .selectAll()
    .where("block_id", "in", blockIds)
    .execute();
  if (photos.length === 0) return [];
  await deletePhotoRows(photos);
  emit({ topic: topics.storageStats(), kind: "updated" });
  return photos.map((p) => p.id);
}

// Delete every photo of an album, cleaning disk/cache (dedup-aware). Used when
// an album is deleted.
export async function deletePhotosByAlbum(albumId: string): Promise<void> {
  const photos = await db
    .selectFrom("photos")
    .selectAll()
    .where("album_id", "=", albumId)
    .execute();
  if (photos.length === 0) return;
  await deletePhotoRows(photos);
  emit({ topic: topics.storageStats(), kind: "updated" });
}

export async function reorderPhotos(
  blockId: string,
  order: { id: string; sortOrder: number }[],
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    for (const e of order) {
      await trx
        .updateTable("photos")
        .set({ sort_order: e.sortOrder })
        .where("id", "=", e.id)
        .where("block_id", "=", blockId)
        .execute();
    }
  });
  const block = await db
    .selectFrom("album_blocks")
    .select("album_id")
    .where("id", "=", blockId)
    .executeTakeFirst();
  const ids = order.map((e) => e.id);
  if (block && ids.length > 0) {
    emitAlbumPatch(block.album_id, { photos: await photosWithImage({ blockId, ids }) });
  }
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
  const row = await db
    .selectFrom("image_files")
    .select("id")
    .where("filename", "=", filename)
    .executeTakeFirst();
  if (!row) throw new AppError(404, "Image not found");
  return new Response(file, {
    headers: { "Cache-Control": "private, max-age=31536000, immutable" },
  });
}

export function originalSize(filename: string): number {
  return statSync(join(ORIGINALS_DIR, filename)).size;
}
