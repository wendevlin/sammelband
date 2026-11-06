import { mkdirSync, rmSync } from "node:fs";
import type { PhotoEdit } from "@sammelband/shared";
import type { Transaction } from "kysely";
import { z } from "zod";
import { config, SRCSET_WIDTHS } from "../config";
import { dbType } from "../db/client";
import type { Album, Database, ImageFile, Photo } from "../db/schema";
import { fail, must } from "../lib/errors";
import { emit, emitAlbumPatch, type PhotoWithImage, topics } from "../lib/events";
import { imageDecoding } from "../lib/semaphore";
import { originalPath, originalsDir, variantPath, videoPath } from "../lib/storage-paths";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { releaseStorage, reserveStorage } from "./tenant.service";

/**
 * Largest accepted image, in pixels (e.g. 12,000 × 8,000). Phones take 50 and
 * even 200 megapixels; `imageDecoding` bounds how many decode at once.
 */
export const MAX_PIXELS = 100_000_000;

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
  // Open album pages need the new `updated_at` (e.g. to mark PDF exports as
  // outdated) and cover.
  const album = await tdb()
    .selectFrom("albums")
    .selectAll()
    .where("id", "=", albumId)
    .executeTakeFirst();
  if (album) emitAlbumPatch(albumId, { album });
}

/** Photos joined with their image metadata, ordered by sort_order. */
export async function photosWithImage(filter: {
  albumId?: string;
  sectionId?: string;
  ids?: string[];
}): Promise<PhotoWithImage[]> {
  let q = tdb()
    .selectFrom("photos as p")
    .innerJoin("image_files as i", "i.id", "p.image_file_id")
    .leftJoin("image_files as s", "s.id", "p.source_image_file_id")
    .selectAll("p")
    .select([
      "s.filename as source_filename",
      "i.filename",
      "i.width",
      "i.height",
      "i.placeholder",
      "i.kind",
      "i.duration_ms",
      "i.video_filename",
      "i.video_status",
      "i.poster_ms",
    ])
    .orderBy("p.sort_order");
  if (filter.albumId) q = q.where("p.album_id", "=", filter.albumId);
  if (filter.sectionId) q = q.where("p.section_id", "=", filter.sectionId);
  if (filter.ids) q = q.where("p.id", "in", filter.ids);
  return (await q.execute()).map((p) => ({ ...p, edit: parseEdit(p.edit) }));
}

/** A stored edit (JSON), or null if there is none or it doesn't parse. */
function parseEdit(json: string | null): PhotoEdit | null {
  if (!json) return null;
  try {
    return editSchema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}

/** A valid edit: a quarter turn, then a crop inside the turned image. */
export const editSchema = z
  .object({
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    crop: z.object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().gt(0).max(1),
      h: z.number().gt(0).max(1),
    }),
  })
  .refine((e) => e.crop.x + e.crop.w <= 1.0001 && e.crop.y + e.crop.h <= 1.0001, {
    message: "The crop must lie inside the photo",
  });

const photoWithImage = (id: string) => photosWithImage({ ids: [id] });

/**
 * Tell open album pages about changed image metadata (a converted video, a new
 * poster): every photo that shows this file, in every album.
 */
export async function imageFileChanged(imageFileId: string): Promise<void> {
  const photos = await tdb()
    .selectFrom("photos")
    .select(["id", "album_id"])
    .where("image_file_id", "=", imageFileId)
    .execute();
  for (const albumId of new Set(photos.map((p) => p.album_id))) {
    const ids = photos.filter((p) => p.album_id === albumId).map((p) => p.id);
    emitAlbumPatch(albumId, { photos: await photosWithImage({ ids }) });
  }
}

/** The album of a section, which uploads go into. */
export async function sectionAlbum(sectionId: string): Promise<string> {
  const section = await tdb()
    .selectFrom("sections")
    .select("album_id")
    .where("id", "=", sectionId)
    .executeTakeFirst();
  if (!section) throw fail("section_not_found");
  return section.album_id;
}

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
  const albumId = await sectionAlbum(sectionId);

  const { imageFile, deduplicated } = await storeOrReuse(Buffer.from(await file.arrayBuffer()));
  return addPhoto(albumId, sectionId, imageFile, uploaderId, deduplicated);
}

/** Store an image, or find the same bytes stored already (one file for both). */
async function storeOrReuse(buf: Buffer): Promise<{ imageFile: ImageFile; deduplicated: boolean }> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(buf);
  const contentHash = hasher.digest("hex");

  const storedFile = () =>
    tdb()
      .selectFrom("image_files")
      .selectAll()
      .where("content_hash", "=", contentHash)
      .executeTakeFirst();

  const existing = await storedFile();
  if (existing) return { imageFile: existing, deduplicated: true };
  try {
    return { imageFile: await storeImageFile(buf, contentHash), deduplicated: false };
  } catch (err) {
    // The same bytes uploaded at the same moment: the other upload stored
    // them first, and the unique (tenant_id, content_hash) index refused
    // this copy (storeImageFile already removed it and gave its storage back).
    const other = await storedFile();
    if (!other) throw err;
    return { imageFile: other, deduplicated: true };
  }
}

/** A new photo (or video) at the end of a section, for a stored file. */
export async function addPhoto(
  albumId: string,
  sectionId: string,
  imageFile: ImageFile,
  uploaderId: string,
  deduplicated: boolean,
): Promise<UploadedPhoto> {
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
    source_image_file_id: null,
    edit: null,
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
  const { width, height, placeholder } = await imageDecoding.run(async () => {
    const { width, height } = await new Bun.Image(buf, { autoOrient: true })
      .metadata()
      .catch(() => ({ width: 0, height: 0 }));
    if (!width || !height) throw fail("unreadable_image");
    // Checked before decoding the pixels: a small file can still decompress to
    // gigabytes (a "decompression bomb").
    if (width * height > MAX_PIXELS) {
      throw fail("image_too_large", { maxMegapixels: MAX_PIXELS / 1e6 });
    }
    return { width, height, placeholder: await new Bun.Image(buf).placeholder() };
  });

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
      kind: "image",
      duration_ms: null,
      video_filename: null,
      video_status: null,
      video_source: null,
      poster_ms: null,
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

/** An image's original and every cached variant, from disk. */
export function removeImageFromDisk(filename: string): void {
  const paths = [originalPath(filename)];
  for (const w of SRCSET_WIDTHS) {
    for (const fmt of ["webp", "jpeg"] as const) {
      paths.push(variantPath(filename, w, fmt));
    }
  }
  removePaths(paths);
}

// Remove an image_file's files from disk: the image (a video's poster) with
// its variants, and the video. Best-effort: file removal can fail (already
// gone, permissions); DB stays consistent.
function removeImageFileFromDisk(file: ImageFile): void {
  removeImageFromDisk(file.filename);
  removePaths([file.video_filename, file.video_source].flatMap((f) => (f ? [videoPath(f)] : [])));
}

function removePaths(paths: string[]): void {
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
      return deleteUnused(
        trx,
        photos.flatMap((p) =>
          p.source_image_file_id ? [p.image_file_id, p.source_image_file_id] : [p.image_file_id],
        ),
      );
    });
  await removeFiles(unused);
}

type Trx = Transaction<Database>;

/**
 * Delete the image_files rows among `ids` that no photo uses any more, as its
 * image or as the original of an edit. Returns them, for `removeFiles`.
 */
async function deleteUnused(trx: Trx, ids: string[]): Promise<ImageFile[]> {
  const candidates = [...new Set(ids)];
  if (candidates.length === 0) return [];
  const used = await trx
    .selectFrom("photos")
    .select(["image_file_id", "source_image_file_id"])
    .where((eb) =>
      eb.or([eb("image_file_id", "in", candidates), eb("source_image_file_id", "in", candidates)]),
    )
    .execute();
  const stillUsed = new Set(used.flatMap((r) => [r.image_file_id, r.source_image_file_id]));
  const unusedIds = candidates.filter((id) => !stillUsed.has(id));
  if (unusedIds.length === 0) return [];
  return trx.deleteFrom("image_files").where("id", "in", unusedIds).returningAll().execute();
}

/** Only touch the disk and the quota once the rows are gone for good. */
async function removeFiles(files: ImageFile[]): Promise<void> {
  for (const file of files) removeImageFileFromDisk(file);
  await releaseStorage(files.reduce((sum, f) => sum + Number(f.file_size), 0));
  if (files.length > 0) emit({ topic: topics.storageStats(), kind: "updated" });
}

// --- Editing ----------------------------------------------------------------------

/**
 * Show a photo edited: `file` is the result (made in the browser from the
 * original), `edit` what was done, kept to edit again from the original.
 * The result is stored like an upload (deduplicated, counted in the quota).
 */
export async function editPhoto(
  photoId: string,
  file: File,
  edit: PhotoEdit,
): Promise<PhotoWithImage> {
  const photo = await getPhoto(photoId);
  if (!photo) throw fail("photo_not_found");
  if (file.size > config.MAX_UPLOAD_BYTES) {
    throw fail("file_too_large", { maxMb: config.MAX_UPLOAD_BYTES / 1024 / 1024 });
  }
  if (!file.type.startsWith("image/")) throw fail("only_images");
  const source = photo.source_image_file_id ?? photo.image_file_id;
  const original = await tdb()
    .selectFrom("image_files")
    .select("kind")
    .where("id", "=", source)
    .executeTakeFirst();
  // Videos have their own still image (setPoster).
  if (original?.kind !== "image") throw fail("only_images");

  const { imageFile } = await storeOrReuse(Buffer.from(await file.arrayBuffer()));
  // Edited back to the original (same bytes): no edit to keep.
  const unchanged = imageFile.id === source;
  return replaceImage(photo, imageFile.id, unchanged ? null : source, unchanged ? null : edit);
}

/** Show the original again. */
export async function resetPhoto(photoId: string): Promise<PhotoWithImage> {
  const photo = await getPhoto(photoId);
  if (!photo) throw fail("photo_not_found");
  if (!photo.source_image_file_id) return must((await photoWithImage(photoId))[0], "Photo");
  return replaceImage(photo, photo.source_image_file_id, null, null);
}

async function replaceImage(
  photo: Photo,
  imageFileId: string,
  sourceId: string | null,
  edit: PhotoEdit | null,
): Promise<PhotoWithImage> {
  const unused = await tdb()
    .transaction()
    .execute(async (trx) => {
      // What it shows now, read here: another edit may have changed it meanwhile.
      // Postgres runs edits side by side: lock the row so a second edit waits
      // and then reads this one's result (SQLite has one connection anyway).
      const before = await trx
        .selectFrom("photos")
        .select("image_file_id")
        .where("id", "=", photo.id)
        .$if(dbType === "postgres", (q) => q.forUpdate())
        .executeTakeFirst();
      await trx
        .updateTable("photos")
        .set({
          image_file_id: imageFileId,
          source_image_file_id: sourceId,
          edit: edit ? JSON.stringify(edit) : null,
        })
        .where("id", "=", photo.id)
        .execute();
      // The image shown before, if nothing else needs it now.
      return deleteUnused(trx, [photo.image_file_id, before?.image_file_id ?? photo.image_file_id]);
    });
  await removeFiles(unused);
  await albumChanged(photo.album_id);
  const [updated] = await photoWithImage(photo.id);
  emitAlbumPatch(photo.album_id, { photos: updated ? [updated] : [] });
  emit({ topic: topics.photoPool(photo.album_id), kind: "updated", id: photo.id });
  return must(updated, "Photo");
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
