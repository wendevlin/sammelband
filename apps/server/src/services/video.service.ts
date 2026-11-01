import { mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import type { Photo as PhotoWithImage } from "@sammelband/shared";
import { config } from "../config";
import { db } from "../db/client";
import type { ImageFile } from "../db/schema";
import { fail, must } from "../lib/errors";
import { emit, topics } from "../lib/events";
import { createJobQueue } from "../lib/job-queue";
import { serveFile } from "../lib/range";
import { imageDecoding } from "../lib/semaphore";
import { originalPath, originalsDir, videoPath, videosDir } from "../lib/storage-paths";
import { currentTenantId, runInTenant, tdb } from "../lib/tenant-context";
import {
  convert,
  defaultPosterMs,
  frameAt,
  probe,
  type VideoInfo,
  videoTools,
  videoToolsAvailable,
} from "../lib/video";
import * as imageService from "./image.service";
import { currentTenant, releaseStorage, reserveStorage } from "./tenant.service";

// Videos in albums. An upload is streamed to disk (videos are large), checked
// with ffprobe and stored with a still frame as its image: from then on it is
// a photo like any other (thumbnails, covers, captions, the PDF). A background
// job converts the upload into the stored format (lib/video.ts), one at a
// time, and deletes the upload; until then the video is "processing". The
// quota counts what is on disk: the upload, later the converted file, plus
// the poster.

const MB = 1024 * 1024;

/**
 * Upload a video into a section; the conversion follows in the background.
 * `declaredSize` (the request's Content-Length) refuses a video that can't
 * fit before it is sent.
 */
export async function uploadVideo(
  body: ReadableStream<Uint8Array> | null,
  sectionId: string,
  uploaderId: string,
  declaredSize?: number,
): Promise<imageService.UploadedPhoto> {
  if (!videoToolsAvailable()) throw fail("videos_unavailable");
  const albumId = await imageService.sectionAlbum(sectionId);
  if (!body) throw fail("no_files");
  if (declaredSize) {
    const max = config.MAX_VIDEO_UPLOAD_BYTES;
    if (declaredSize > max) throw fail("video_too_large", { maxMb: Math.round(max / MB) });
    const { quota_bytes, storage_used_bytes } = await currentTenant();
    if (quota_bytes !== null && storage_used_bytes + declaredSize > quota_bytes) {
      throw fail("quota_exceeded");
    }
  }

  mkdirSync(videosDir(currentTenantId()), { recursive: true });
  const source = `${Bun.randomUUIDv7()}.upload`;
  const sourcePath = videoPath(source);
  let keepSource = false;
  try {
    const { size, contentHash } = await receive(body, sourcePath);
    const stored = () =>
      tdb()
        .selectFrom("image_files")
        .selectAll()
        .where("content_hash", "=", contentHash)
        .executeTakeFirst();
    const existing = await stored();
    if (existing) {
      return imageService.addPhoto(albumId, sectionId, existing, uploaderId, true);
    }

    const info = await videoTools.run(() => probe(sourcePath));
    if (!info) throw fail("unreadable_video");
    let imageFile: ImageFile;
    let deduplicated = false;
    try {
      imageFile = await storeVideoFile(sourcePath, source, size, contentHash, info);
      keepSource = true;
    } catch (err) {
      // The same video uploaded at the same moment: the other upload stored it.
      const other = await stored();
      if (!other) throw err;
      imageFile = other;
      deduplicated = true;
    }
    const uploaded = await imageService.addPhoto(
      albumId,
      sectionId,
      imageFile,
      uploaderId,
      deduplicated,
    );
    if (!deduplicated) queue.enqueue({ tenantId: currentTenantId(), imageFileId: imageFile.id });
    return uploaded;
  } finally {
    if (!keepSource) rmSync(sourcePath, { force: true });
  }
}

/** Write the request body to `path`, hashing it on the way; refuses more than the limit. */
async function receive(
  body: ReadableStream<Uint8Array>,
  path: string,
): Promise<{ size: number; contentHash: string }> {
  const max = config.MAX_VIDEO_UPLOAD_BYTES;
  const hasher = new Bun.CryptoHasher("sha256");
  const sink = Bun.file(path).writer();
  let size = 0;
  try {
    for await (const chunk of body) {
      size += chunk.byteLength;
      if (size > max) throw fail("video_too_large", { maxMb: Math.round(max / MB) });
      hasher.update(chunk);
      sink.write(chunk);
    }
  } finally {
    await sink.end();
  }
  if (size === 0) throw fail("no_files");
  return { size, contentHash: hasher.digest("hex") };
}

/** A still frame of a video, ready to store as its image. */
async function poster(path: string, ms: number, info: VideoInfo) {
  const bytes = await videoTools.run(() => frameAt(path, ms, info));
  if (bytes.byteLength === 0) throw fail("unreadable_video");
  return imageDecoding.run(async () => {
    const image = new Bun.Image(bytes);
    const { width, height } = await image.metadata().catch(() => ({ width: 0, height: 0 }));
    if (!width || !height) throw fail("unreadable_video");
    return { bytes, width, height, placeholder: await new Bun.Image(bytes).placeholder() };
  });
}

/** Record a new upload: its poster as the image, the upload until it is converted. */
async function storeVideoFile(
  sourcePath: string,
  source: string,
  size: number,
  contentHash: string,
  info: VideoInfo,
): Promise<ImageFile> {
  const posterMs = defaultPosterMs(info.durationMs);
  const frame = await poster(sourcePath, posterMs, info);
  const total = size + frame.bytes.byteLength;
  await reserveStorage(total);
  const filename = `${Bun.randomUUIDv7()}.bin`;
  const path = originalPath(filename);
  try {
    mkdirSync(originalsDir(currentTenantId()), { recursive: true });
    await Bun.write(path, frame.bytes);
    const imageFile: ImageFile = {
      id: Bun.randomUUIDv7(),
      tenant_id: currentTenantId(),
      content_hash: contentHash,
      filename,
      width: frame.width,
      height: frame.height,
      file_size: total,
      placeholder: frame.placeholder,
      created_at: Date.now(),
      kind: "video",
      duration_ms: info.durationMs,
      video_filename: null,
      video_status: "processing",
      video_source: source,
      poster_ms: posterMs,
    };
    await tdb().insertInto("image_files").values(imageFile).execute();
    return imageFile;
  } catch (err) {
    rmSync(path, { force: true });
    await releaseStorage(total);
    throw err;
  }
}

// --- Converting -------------------------------------------------------------------

type Job = { tenantId: string; imageFileId: string };

const queue = createJobQueue<Job>("video", (job) =>
  runInTenant(job.tenantId, () => convertVideo(job.imageFileId)),
);

/** Wait until queued conversions are done (tests). */
export function videosIdle(): Promise<void> {
  return queue.idle();
}

/** Startup: queue the conversions a restart interrupted, in every tenant. */
export async function resumeVideos(): Promise<void> {
  const rows = await db
    .selectFrom("image_files")
    .select(["id", "tenant_id"])
    .where("video_status", "=", "processing")
    .orderBy("created_at")
    .execute();
  for (const row of rows) queue.enqueue({ tenantId: row.tenant_id, imageFileId: row.id });
}

const getFile = async (id: string) =>
  (await tdb().selectFrom("image_files").selectAll().where("id", "=", id).executeTakeFirst()) ??
  null;

async function convertVideo(id: string): Promise<void> {
  const row = await getFile(id);
  if (row?.video_status !== "processing" || !row.video_source) return;
  const sourcePath = videoPath(row.video_source);
  const sourceSize = statSync(sourcePath, { throwIfNoEntry: false })?.size ?? 0;
  const filename = `${Bun.randomUUIDv7()}.mp4`;
  const part = videoPath(`${filename}.part`);
  try {
    const info = await videoTools.run(() => probe(sourcePath));
    if (!info) throw fail("unreadable_video");
    await convert(sourcePath, part, info);
    const size = statSync(part).size;
    // Converted files are nearly always smaller; a larger one needs the room.
    if (size > sourceSize) await reserveStorage(size - sourceSize);
    renameSync(part, videoPath(filename));
    const result = await tdb()
      .updateTable("image_files")
      .set({
        video_filename: filename,
        video_status: "ready",
        video_source: null,
        file_size: Number(row.file_size) - sourceSize + size,
      })
      .where("id", "=", id)
      .where("video_status", "=", "processing")
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) {
      // Deleted while it was converted: its storage went with the row.
      rmSync(videoPath(filename), { force: true });
      if (size > sourceSize) await releaseStorage(size - sourceSize);
      return;
    }
    rmSync(sourcePath, { force: true });
    if (size < sourceSize) await releaseStorage(sourceSize - size);
  } catch (err) {
    rmSync(part, { force: true });
    const result = await tdb()
      .updateTable("image_files")
      .set({
        video_status: "failed",
        video_source: null,
        file_size: Number(row.file_size) - sourceSize,
      })
      .where("id", "=", id)
      .where("video_status", "=", "processing")
      .executeTakeFirst();
    // Deleted meanwhile (its upload with it): nothing went wrong.
    if (Number(result.numUpdatedRows) === 0) return;
    console.error("[video] conversion failed", { id, err });
    rmSync(sourcePath, { force: true });
    await releaseStorage(sourceSize);
  }
  await imageService.imageFileChanged(id);
  emit({ topic: topics.storageStats(), kind: "updated" });
}

// --- The poster -------------------------------------------------------------------

/** Take the video's still image from `ms` (e.g. the frame paused at in the editor). */
export async function setPoster(photoId: string, ms: number): Promise<PhotoWithImage> {
  const photo = await tdb()
    .selectFrom("photos")
    .select(["id", "image_file_id"])
    .where("id", "=", photoId)
    .executeTakeFirst();
  if (!photo) throw fail("photo_not_found");
  const file = must(await getFile(photo.image_file_id), "Image");
  if (file.kind !== "video") throw fail("not_a_video");
  const playable = file.video_filename ?? file.video_source;
  if (!playable) throw fail("video_not_ready");
  const path = videoPath(playable);
  const info = await videoTools.run(() => probe(path));
  if (!info) throw fail("unreadable_video");
  const at = Math.max(0, Math.min(Math.round(ms), info.durationMs - 1));
  const frame = await poster(path, at, info);

  const oldSize = statSync(originalPath(file.filename), { throwIfNoEntry: false })?.size ?? 0;
  const newSize = frame.bytes.byteLength;
  if (newSize > oldSize) await reserveStorage(newSize - oldSize);
  const filename = `${Bun.randomUUIDv7()}.bin`;
  try {
    await Bun.write(originalPath(filename), frame.bytes);
    await tdb()
      .updateTable("image_files")
      .set({
        filename,
        width: frame.width,
        height: frame.height,
        placeholder: frame.placeholder,
        poster_ms: at,
        file_size: Number(file.file_size) - oldSize + newSize,
      })
      .where("id", "=", file.id)
      .execute();
  } catch (err) {
    rmSync(originalPath(filename), { force: true });
    if (newSize > oldSize) await releaseStorage(newSize - oldSize);
    throw err;
  }
  if (newSize < oldSize) await releaseStorage(oldSize - newSize);
  imageService.removeImageFromDisk(file.filename);

  // The poster may be an album's cover, in any album that has this video.
  const albums = await tdb()
    .selectFrom("photos")
    .select("album_id")
    .distinct()
    .where("image_file_id", "=", file.id)
    .execute();
  for (const { album_id } of albums) await imageService.albumChanged(album_id);
  await imageService.imageFileChanged(file.id);
  const [updated] = await imageService.photosWithImage({ ids: [photoId] });
  return must(updated, "Photo");
}

// --- Playing ------------------------------------------------------------------------

// Stored names are "<uuid>.mp4"; anything else never reaches the filesystem.
const VIDEO_RE = /^[0-9a-f-]{36}\.mp4$/;

/** A converted video of the current tenant, in parts as the player asks (Range). */
export async function serveVideo(filename: string, range: string | undefined): Promise<Response> {
  if (!VIDEO_RE.test(filename)) throw fail("video_not_found");
  const row = await tdb()
    .selectFrom("image_files")
    .select("id")
    .where("video_filename", "=", filename)
    .executeTakeFirst();
  if (!row) throw fail("video_not_found");
  const file = Bun.file(videoPath(filename));
  if (!(await file.exists())) throw fail("video_not_found");
  return serveFile(file, range, {
    "Content-Type": "video/mp4",
    "Cache-Control": "private, max-age=31536000, immutable",
  });
}
