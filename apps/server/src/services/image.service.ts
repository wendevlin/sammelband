import { mkdirSync, rmSync } from "node:fs";
import { config, SRCSET_WIDTHS } from "../config";
import type { Album, ImageFile, Photo } from "../db/schema";
import { fail, must } from "../lib/errors";
import { emit, emitAlbumPatch, type PhotoWithImage, topics } from "../lib/events";
import { originalPath, originalsDir, variantPath } from "../lib/storage-paths";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { releaseStorage, reserveStorage } from "./tenant.service";

/** Largest accepted image, in pixels (e.g. 12,000 × 8,000). */
const MAX_PIXELS = 100_000_000;

export type UploadedPhoto = {
  photo: Photo;
  imageFile: ImageFile;
  deduplicated: boolean;
};

/**
 * The cover image of an album: the explicitly chosen cover, else its first
 * image (first photo of the first section with photos), else null.
 */
async function computeCover(albumId: string): Promise<string | null> {
  const chosen = await tdb()
    .selectFrom("albums as a")
    .innerJoin("photos as p", "p.id", "a.cover_photo_id")
    .innerJoin("image_files as i", "i.id", "p.image_file_id")
    .select("i.filename")
    .where("a.id", "=", albumId)
    .executeTakeFirst();
  if (chosen) return chosen.filename;
  const first = await tdb()
    .selectFrom("photos as p")
    .innerJoin("image_files as i", "i.id", "p.image_file_id")
    .innerJoin("sections as s", "s.id", "p.section_id")
    .select("i.filename")
    .where("p.album_id", "=", albumId)
    .orderBy("s.sort_order")
    .orderBy("p.sort_order")
    .limit(1)
    .executeTakeFirst();
  return first?.filename ?? null;
}

/**
 * Record that an album's content changed: bumps `updated_at` (the "recently
 * changed" order counts content edits) and recomputes the stored
 * `cover_filename`, so listing albums never has to look covers up. Every
 * change to sections, photos or the chosen cover must call this.
 */
export async function albumChanged(albumId: string): Promise<void> {
  await tdb()
    .updateTable("albums")
    .set({ updated_at: Date.now(), cover_filename: await computeCover(albumId) })
    .where("id", "=", albumId)
    .execute();
}

/** Photos joined with their image metadata, ordered by sort_order. */
export function photosWithImage(filter: {
  albumId?: string;
  sectionId?: string;
  ids?: string[];
}): Promise<PhotoWithImage[]> {
  let q = tdb()
    .selectFrom("photos as p")
    .innerJoin("image_files as i", "i.id", "p.image_file_id")
    .selectAll("p")
    .select(["i.filename", "i.width", "i.height", "i.placeholder"])
    .orderBy("p.sort_order");
  if (filter.albumId) q = q.where("p.album_id", "=", filter.albumId);
  if (filter.sectionId) q = q.where("p.section_id", "=", filter.sectionId);
  if (filter.ids) q = q.where("p.id", "in", filter.ids);
  return q.execute();
}

const photoWithImage = (id: string) => photosWithImage({ ids: [id] });

async function getPhoto(id: string): Promise<Photo | null> {
  return (
    (await tdb().selectFrom("photos").selectAll().where("id", "=", id).executeTakeFirst()) ?? null
  );
}

async function getAlbumRow(id: string): Promise<Album> {
  return tdb().selectFrom("albums").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

export async function uploadPhoto(
  file: File,
  sectionId: string,
  uploaderId: string,
): Promise<UploadedPhoto> {
  if (file.size > config.MAX_UPLOAD_BYTES) {
    throw fail("file_too_large", { maxMb: config.MAX_UPLOAD_BYTES / 1024 / 1024 });
  }
  if (!file.type.startsWith("image/")) {
    throw fail("only_images");
  }
  // Photos belong to a section; the album is derived from it.
  const section = await tdb()
    .selectFrom("sections")
    .select("album_id")
    .where("id", "=", sectionId)
    .executeTakeFirst();
  if (!section) throw fail("section_not_found");
  const albumId = section.album_id;

  const buf = Buffer.from(await file.arrayBuffer());

  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buf);
  const contentHash = hasher.digest("hex");

  let imageFile = await tdb()
    .selectFrom("image_files")
    .selectAll()
    .where("content_hash", "=", contentHash)
    .executeTakeFirst();

  let deduplicated = false;

  if (!imageFile) {
    imageFile = await storeImageFile(buf, contentHash);
  } else {
    deduplicated = true;
  }

  const { max } = await tdb()
    .selectFrom("photos")
    .select((eb) => eb.fn.max("sort_order").as("max"))
    .where("section_id", "=", sectionId)
    .executeTakeFirstOrThrow();

  const photo: Photo = {
    id: Bun.randomUUIDv7(),
    tenant_id: currentTenantId(),
    album_id: albumId,
    section_id: sectionId,
    sort_order: (max ?? 0) + 1,
    image_file_id: imageFile.id,
    caption: null,
    uploaded_by: uploaderId,
    uploaded_at: Date.now(),
  };
  await tdb().insertInto("photos").values(photo).execute();
  // One small event per photo, so other viewers see a batch arrive one by one.
  await albumChanged(albumId);
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

/** Write a new original to disk and record it; counts towards the tenant's quota. */
async function storeImageFile(buf: Buffer, contentHash: string): Promise<ImageFile> {
  const { width, height } = await new Bun.Image(buf, { autoOrient: true })
    .metadata()
    .catch(() => ({ width: 0, height: 0 }));
  if (!width || !height) throw fail("unreadable_image");
  // Checked before decoding the pixels: a small file can still decompress to
  // gigabytes (a "decompression bomb").
  if (width * height > MAX_PIXELS) {
    throw fail("image_too_large", { maxMegapixels: MAX_PIXELS / 1e6 });
  }
  const placeholder = await new Bun.Image(buf).placeholder();

  await reserveStorage(buf.byteLength);
  const filename = `${Bun.randomUUIDv7()}.bin`;
  const path = originalPath(filename);
  try {
    mkdirSync(originalsDir(currentTenantId()), { recursive: true });
    await Bun.write(path, buf);
    const imageFile: ImageFile = {
      id: Bun.randomUUIDv7(),
      tenant_id: currentTenantId(),
      content_hash: contentHash,
      filename,
      width,
      height,
      file_size: buf.byteLength,
      placeholder,
      created_at: Date.now(),
    };
    await tdb().insertInto("image_files").values(imageFile).execute();
    return imageFile;
  } catch (err) {
    rmSync(path, { force: true });
    await releaseStorage(buf.byteLength);
    throw err;
  }
}

export async function updateCaption(photoId: string, caption: string | null): Promise<Photo> {
  if (!(await getPhoto(photoId))) throw fail("photo_not_found");
  await tdb().updateTable("photos").set({ caption }).where("id", "=", photoId).execute();
  const updated = must(await getPhoto(photoId), "Photo");
  await albumChanged(updated.album_id);
  emitAlbumPatch(updated.album_id, { photos: await photoWithImage(photoId) });
  emit({ topic: topics.photoPool(updated.album_id), kind: "updated", id: photoId });
  return updated;
}

// Remove an image_file's original AND every cached variant from disk.
// Best-effort: file removal can fail (already gone, permissions); DB stays consistent.
function removeImageFileFromDisk(file: ImageFile): void {
  const paths = [originalPath(file.filename)];
  for (const w of SRCSET_WIDTHS) {
    for (const fmt of ["webp", "jpeg"] as const) {
      paths.push(variantPath(file.filename, w, fmt));
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
  const unused = await tdb()
    .transaction()
    .execute(async (trx) => {
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
  // Only touch the disk and the quota once the rows are gone for good.
  for (const file of unused) removeImageFileFromDisk(file);
  await releaseStorage(unused.reduce((sum, f) => sum + f.file_size, 0));
}

export async function deletePhoto(photoId: string): Promise<void> {
  const photo = await getPhoto(photoId);
  if (!photo) throw fail("photo_not_found");

  await deletePhotoRows([photo]);
  await albumChanged(photo.album_id);
  // A trigger clears the cover if this photo was it, so resend the album row.
  const album = await getAlbumRow(photo.album_id);
  emitAlbumPatch(photo.album_id, { album, removedPhotos: [photoId] });
  emit({ topic: topics.photoPool(photo.album_id), kind: "deleted", id: photoId });
  emit({ topic: topics.storageStats(), kind: "updated" });
}

// Delete every photo of a section, cleaning disk/cache (dedup-aware). Used when
// a section is deleted. Returns the deleted photo ids; the caller emits the
// album change.
export async function deletePhotosBySection(sectionId: string): Promise<string[]> {
  const photos = await tdb()
    .selectFrom("photos")
    .selectAll()
    .where("section_id", "=", sectionId)
    .execute();
  if (photos.length === 0) return [];
  await deletePhotoRows(photos);
  emit({ topic: topics.storageStats(), kind: "updated" });
  return photos.map((p) => p.id);
}

// Delete every photo of an album, cleaning disk/cache (dedup-aware). Used when
// an album is deleted.
export async function deletePhotosByAlbum(albumId: string): Promise<void> {
  const photos = await tdb()
    .selectFrom("photos")
    .selectAll()
    .where("album_id", "=", albumId)
    .execute();
  if (photos.length === 0) return;
  await deletePhotoRows(photos);
  emit({ topic: topics.storageStats(), kind: "updated" });
}

/**
 * Move a photo into a section of the same album, before `beforeId` (null: at
 * the end). Also works within its own section.
 */
export async function movePhoto(
  photoId: string,
  sectionId: string,
  beforeId: string | null,
): Promise<Photo> {
  const photo = await getPhoto(photoId);
  if (!photo) throw fail("photo_not_found");
  const section = await tdb()
    .selectFrom("sections")
    .select("album_id")
    .where("id", "=", sectionId)
    .executeTakeFirst();
  if (!section || section.album_id !== photo.album_id) throw fail("section_not_found");

  const others = tdb()
    .selectFrom("photos")
    .select("sort_order")
    .where("section_id", "=", sectionId)
    .where("id", "!=", photoId);
  let sortOrder: number;
  if (beforeId) {
    const before = await getPhoto(beforeId);
    if (!before || before.section_id !== sectionId) throw fail("target_photo_not_found");
    const prev = await others
      .where("sort_order", "<", before.sort_order)
      .orderBy("sort_order", "desc")
      .limit(1)
      .executeTakeFirst();
    sortOrder = prev ? (prev.sort_order + before.sort_order) / 2 : before.sort_order - 1;
  } else {
    const last = await others.orderBy("sort_order", "desc").limit(1).executeTakeFirst();
    sortOrder = (last?.sort_order ?? 0) + 1;
  }

  await tdb()
    .updateTable("photos")
    .set({ section_id: sectionId, sort_order: sortOrder })
    .where("id", "=", photoId)
    .execute();
  await albumChanged(photo.album_id);
  emitAlbumPatch(photo.album_id, { photos: await photoWithImage(photoId) });
  return must(await getPhoto(photoId), "Photo");
}

export async function reorderPhotos(
  sectionId: string,
  order: { id: string; sortOrder: number }[],
): Promise<void> {
  await tdb()
    .transaction()
    .execute(async (trx) => {
      for (const e of order) {
        await trx
          .updateTable("photos")
          .set({ sort_order: e.sortOrder })
          .where("id", "=", e.id)
          .where("section_id", "=", sectionId)
          .execute();
      }
    });
  const section = await tdb()
    .selectFrom("sections")
    .select("album_id")
    .where("id", "=", sectionId)
    .executeTakeFirst();
  const ids = order.map((e) => e.id);
  if (section && ids.length > 0) {
    await albumChanged(section.album_id);
    emitAlbumPatch(section.album_id, { photos: await photosWithImage({ sectionId, ids }) });
  }
}
