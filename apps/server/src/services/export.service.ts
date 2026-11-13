import { mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import {
  type AlbumExport,
  builtinProfile,
  builtinProfileId,
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportOptions,
  type ExportProfileSnapshot,
  type ExportWarning,
} from "@sammelband/shared";
import { z } from "zod";
import { db } from "../db/client";
import type { AlbumExportRow } from "../db/schema";
import { AppError, fail, must } from "../lib/errors";
import { emit, topics } from "../lib/events";
import { exportProfileSpecSchema } from "../lib/export-profile-schema";
import { createJobQueue } from "../lib/job-queue";
import { exportPath, exportsDir, originalPath } from "../lib/storage-paths";
import { currentTenantId, runInTenant, tdb } from "../lib/tenant-context";
import { exportEnabled, usableProfile } from "./export-profile.service";
import * as imageService from "./image.service";
import type { LayoutPhoto } from "./pdf/layout";
import { renderAlbumPdf } from "./pdf/render";
import * as sectionService from "./section.service";
import * as shareService from "./share.service";
import { releaseStorage, reserveStorage } from "./tenant.service";

// PDF exports of albums. Creating one queues a job; the job lays out and
// renders the PDF in the background (pdf/), stores it under the tenant's
// exports/ and counts it against the quota. The file stays until someone
// deletes it, or the album. Progress goes out as change events, so the
// export dialog and the list of exports follow along.
//
// Videos are printed as their poster with a QR code. The codes lead to a
// public link that the export gets when it is rendered (share.service.ts:
// one per PDF, showing only the album's videos), so a printed book can play them.
// With the album link option, the back gets a QR code to the whole album: a
// second link of the PDF's own, that behaves the same way.
//
// An export is made with a print profile (export-profile.service.ts) and keeps
// a copy of it. Profiles with a separate cover give a second file
// (`cover_filename`); both count against the quota and go together.

// `options` JSON. Exports made before the purposes had a `quality` instead:
// "print" meant a PDF with margins (now "home"), "screen" the same as now.
const optionsSchema = z
  .object({
    purpose: z.enum(["home", "print", "screen"]).optional(),
    quality: z.enum(["print", "screen"]).optional(),
    captions: z.boolean().catch(true),
    album_link: z.boolean().catch(false),
  })
  .transform(
    ({ purpose, quality, captions, album_link }): ExportOptions => ({
      purpose: purpose ?? (quality === "screen" ? "screen" : "home"),
      captions,
      album_link,
    }),
  );

type LinkRow = { id: string; token: string };
type ExportLinks = { videos?: LinkRow; album?: LinkRow };

/** The links of these exports (videos, album), by export id. */
async function exportLinks(rows: AlbumExportRow[]): Promise<Map<string, ExportLinks>> {
  if (rows.length === 0) return new Map();
  const links = await tdb()
    .selectFrom("share_links")
    .select(["id", "token", "export_id", "videos_only"])
    .where(
      "export_id",
      "in",
      rows.map((r) => r.id),
    )
    .execute();
  const byExport = new Map<string, ExportLinks>();
  for (const { export_id, videos_only, ...link } of links) {
    const entry = byExport.get(export_id ?? "") ?? {};
    entry[videos_only ? "videos" : "album"] = link;
    byExport.set(export_id ?? "", entry);
  }
  return byExport;
}

async function present(row: AlbumExportRow): Promise<AlbumExport> {
  return toExport(row, (await exportLinks([row])).get(row.id));
}

const linkInfo = (link?: LinkRow) =>
  link ? { id: link.id, url: shareService.shareUrl(link.token) } : null;

const snapshotSchema = z.object({
  id: z.string(),
  builtin: z.boolean(),
  name: z.string().nullable(),
  spec: exportProfileSpecSchema,
});

const warningsSchema = z.array(
  z.object({
    code: z.enum(["blank_pages", "photos_cropped"]),
    params: z.object({ count: z.number() }),
  }),
);

/**
 * The profile an export was made with: its copy, or for exports from before
 * profiles the built-in one of its format and purpose.
 */
function profileOf(row: AlbumExportRow, options: ExportOptions): ExportProfileSnapshot {
  if (row.profile) {
    const snapshot = storedProfile(row);
    if (snapshot) return snapshot;
    // Unreadable: shown as the built-in profile of its format; it isn't made with it (runExport).
  }
  const format = (EXPORT_FORMATS as readonly string[]).includes(row.format)
    ? (row.format as ExportFormat)
    : "a4";
  const id = builtinProfileId(options.purpose, format);
  return { id, builtin: true, name: null, spec: must(builtinProfile(id), "Profile").spec };
}

/** The profile copy an export keeps, or null if it is missing or no longer readable. */
function storedProfile(row: AlbumExportRow): ExportProfileSnapshot | null {
  try {
    return row.profile ? snapshotSchema.parse(JSON.parse(row.profile)) : null;
  } catch {
    return null;
  }
}

function warningsOf(row: AlbumExportRow): ExportWarning[] {
  try {
    return row.warnings ? warningsSchema.parse(JSON.parse(row.warnings)) : [];
  } catch {
    return [];
  }
}

function toExport(row: AlbumExportRow, links: ExportLinks = {}): AlbumExport {
  let options: ExportOptions;
  try {
    options = optionsSchema.parse(JSON.parse(row.options));
  } catch {
    options = { purpose: "home", captions: true, album_link: false };
  }
  return {
    id: row.id,
    album_id: row.album_id,
    name: row.name,
    profile: profileOf(row, options),
    options,
    status: row.status as AlbumExport["status"],
    progress: row.progress,
    error_code: row.error_code,
    page_count: row.page_count,
    file_size: row.file_size === null ? null : Number(row.file_size),
    has_cover_file: row.cover_filename !== null,
    warnings: warningsOf(row),
    created_by: row.created_by,
    created_at: Number(row.created_at),
    finished_at: row.finished_at === null ? null : Number(row.finished_at),
    album_updated_at: row.album_updated_at === null ? null : Number(row.album_updated_at),
    video_link: linkInfo(links.videos),
    album_link: linkInfo(links.album),
  };
}

async function getRow(id: string): Promise<AlbumExportRow | null> {
  return (
    (await tdb().selectFrom("album_exports").selectAll().where("id", "=", id).executeTakeFirst()) ??
    null
  );
}

async function requireRow(id: string): Promise<AlbumExportRow> {
  const row = await getRow(id);
  if (!row) throw fail("export_not_found");
  return row;
}

async function requireAlbum(albumId: string) {
  const album = await tdb()
    .selectFrom("albums")
    .selectAll()
    .where("id", "=", albumId)
    .executeTakeFirst();
  if (!album) throw fail("album_not_found");
  return album;
}

async function changed(
  row: AlbumExportRow,
  kind: "created" | "updated" | "deleted" = "updated",
): Promise<void> {
  const data = kind === "deleted" ? toExport(row) : await present(row);
  emit({ topic: topics.albumExports(row.album_id), kind, id: row.id, data });
}

async function update(
  id: string,
  changes: Partial<AlbumExportRow>,
): Promise<AlbumExportRow | null> {
  await tdb().updateTable("album_exports").set(changes).where("id", "=", id).execute();
  const row = await getRow(id);
  if (row) await changed(row);
  return row;
}

/** An album's exports, newest first. */
export async function listExports(albumId: string): Promise<AlbumExport[]> {
  await requireAlbum(albumId);
  const rows = await tdb()
    .selectFrom("album_exports")
    .selectAll()
    .where("album_id", "=", albumId)
    .orderBy("created_at", "desc")
    .execute();
  const links = await exportLinks(rows);
  return rows.map((r) => toExport(r, links.get(r.id)));
}

/** The page format of a built-in profile of one ("custom" for every other). */
function formatOf(profile: ExportProfileSnapshot): string {
  const format = profile.builtin ? profile.id.split(":")[1] : undefined;
  return format && (EXPORT_FORMATS as readonly string[]).includes(format) ? format : "custom";
}

/** Queue an export of an album; returns at once, the PDF follows in the background. */
export async function createExport(
  albumId: string,
  userId: string,
  input: { profileId: string; captions: boolean; albumLink?: boolean },
): Promise<AlbumExport> {
  if (!(await exportEnabled())) throw fail("export_disabled");
  const profile = await usableProfile(input.profileId);
  const album = await requireAlbum(albumId);
  const sections = await sectionService.listSections(albumId);
  const photos = await tdb()
    .selectFrom("photos")
    .select("id")
    .where("album_id", "=", albumId)
    .executeTakeFirst();
  if (!photos && !sections.some((s) => s.title.trim() || s.text.trim())) {
    throw fail("album_empty");
  }
  const row: AlbumExportRow = {
    id: Bun.randomUUIDv7(),
    tenant_id: currentTenantId(),
    album_id: albumId,
    name: album.title,
    // Kept for older versions reading the row: the format of a built-in profile.
    format: formatOf(profile),
    options: JSON.stringify({
      purpose: profile.spec.purpose,
      captions: input.captions,
      // The QR code to the album goes on the back: a profile without a cover has none.
      album_link: (input.albumLink ?? false) && profile.spec.cover.mode !== "none",
    }),
    status: "queued",
    progress: 0,
    error_code: null,
    page_count: null,
    file_size: null,
    filename: null,
    created_by: userId,
    created_at: Date.now(),
    finished_at: null,
    album_updated_at: null,
    profile: JSON.stringify(profile),
    cover_filename: null,
    warnings: null,
  };
  await tdb().insertInto("album_exports").values(row).execute();
  await changed(row, "created");
  queue.enqueue({ tenantId: row.tenant_id, id: row.id });
  return toExport(row);
}

export async function renameExport(id: string, name: string): Promise<AlbumExport> {
  const trimmed = name.trim();
  if (!trimmed) throw fail("name_required");
  await requireRow(id);
  return present(must(await update(id, { name: trimmed }), "Export"));
}

/**
 * Remove the row and its file; a running job notices and throws its work away.
 * Its links go too, unless `keepLinks` (printed copies keep working).
 */
export async function deleteExport(id: string, keepLinks = false): Promise<void> {
  const row = await requireRow(id);
  await shareService.releaseExportLinks(row, keepLinks);
  await tdb().deleteFrom("album_exports").where("id", "=", id).execute();
  await removeFile(row);
  await changed(row, "deleted");
}

/** Every export of an album (the album is being deleted). */
export async function deleteExportsByAlbum(albumId: string): Promise<void> {
  const rows = await tdb()
    .selectFrom("album_exports")
    .selectAll()
    .where("album_id", "=", albumId)
    .execute();
  if (rows.length === 0) return;
  await tdb().deleteFrom("album_exports").where("album_id", "=", albumId).execute();
  for (const row of rows) await removeFile(row);
}

async function removeFile(row: AlbumExportRow): Promise<void> {
  if (!row.filename) return;
  rmSync(exportPath(row.filename), { force: true });
  if (row.cover_filename) rmSync(exportPath(row.cover_filename), { force: true });
  if (row.status === "done" && row.file_size) {
    await releaseStorage(Number(row.file_size));
    emit({ topic: topics.storageStats(), kind: "updated" });
  }
}

/**
 * The finished PDF, as a download named after the export; `cover` the
 * separate cover of profiles that have one.
 */
export async function downloadExport(
  id: string,
  part: "book" | "cover" = "book",
): Promise<Response> {
  const row = await requireRow(id);
  if (row.status !== "done" || !row.filename) throw fail("export_not_ready");
  const filename = part === "cover" ? row.cover_filename : row.filename;
  if (!filename) throw fail("export_not_found");
  const file = Bun.file(exportPath(filename));
  if (!(await file.exists())) throw fail("export_not_found");
  const name = part === "cover" ? `${row.name} – Cover.pdf` : `${row.name}.pdf`;
  return new Response(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(name),
      "Cache-Control": "private, no-cache",
    },
  });
}

/** `attachment` with an ASCII fallback and the full UTF-8 name (RFC 6266). */
function contentDisposition(name: string): string {
  const ascii = name.normalize("NFKD").replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// --- The job ------------------------------------------------------------------

const queue = createJobQueue<{ tenantId: string; id: string }>("export", (job) =>
  runInTenant(job.tenantId, () => runExport(job.id)),
);

/** Wait until queued exports are done (tests). */
export function exportsIdle(): Promise<void> {
  return queue.idle();
}

/** Startup: queue the exports that a restart interrupted, in every tenant. */
export async function resumeExports(): Promise<void> {
  const rows = await db
    .selectFrom("album_exports")
    .select(["id", "tenant_id"])
    .where("status", "in", ["queued", "running"])
    .orderBy("created_at")
    .execute();
  for (const row of rows) queue.enqueue({ tenantId: row.tenant_id, id: row.id });
}

/** Progress updates at most this often (ms): enough for a progress bar. */
const PROGRESS_INTERVAL = 700;

async function runExport(id: string): Promise<void> {
  const row = await getRow(id);
  if (!row || row.status === "done") return;
  const { options, profile } = toExport(row);
  const filename = `${Bun.randomUUIDv7()}.pdf`;
  const partial = exportPath(`${filename}.part`);
  const separateCover = profile.spec.cover.mode === "separate";
  const coverFilename = separateCover ? `${Bun.randomUUIDv7()}.pdf` : null;
  const coverPartial = coverFilename ? exportPath(`${coverFilename}.part`) : undefined;
  const removePartials = () => {
    rmSync(partial, { force: true });
    if (coverPartial) rmSync(coverPartial, { force: true });
  };
  try {
    // A copy of a profile that no longer reads is not silently replaced by another one.
    if (row.profile && !storedProfile(row)) throw fail("export_failed");
    await update(id, { status: "running", progress: 0, error_code: null });
    const album = await requireAlbum(row.album_id);
    const sections = await sectionService.listSections(row.album_id);
    const photos = await imageService.photosWithImage({ albumId: row.album_id });
    const filenames = new Map(photos.map((p) => [p.id, p.filename]));
    const toLayout = (p: (typeof photos)[number]): LayoutPhoto => ({
      id: p.id,
      ratio: p.width / p.height,
      caption: p.caption,
    });
    const coverPhoto = photos.find((p) => p.filename === album.cover_filename);
    // Videos get a QR code to the PDF's video link.
    const videos = new Map<string, { url: string; durationMs: number }>();
    if (photos.some((p) => p.kind === "video")) {
      const link = await shareService.exportLinkFor(row, "videos");
      for (const p of photos) {
        if (p.kind !== "video") continue;
        videos.set(p.id, {
          url: shareService.videoUrl(link.token, p.id),
          durationMs: Number(p.duration_ms ?? 0),
        });
      }
    }
    // The back gets a QR code to the album.
    const albumUrl = options.album_link
      ? shareService.shareUrl((await shareService.exportLinkFor(row, "album")).token)
      : null;

    mkdirSync(exportsDir(currentTenantId()), { recursive: true });
    let lastUpdate = 0;
    const result = await renderAlbumPdf(
      {
        title: album.title,
        description: album.description,
        cover: coverPhoto ? toLayout(coverPhoto) : null,
        sections: sections.map((s) => ({
          title: s.title,
          text: s.text,
          highlight: s.highlight,
          photos: photos.filter((p) => p.section_id === s.id).map(toLayout),
        })),
        profile: profile.spec,
        captions: options.captions,
        original: (photoId) => originalPath(must(filenames.get(photoId), "Photo")),
        videos,
        albumUrl,
        onProgress: async (share) => {
          const now = Date.now();
          if (now - lastUpdate < PROGRESS_INTERVAL) return;
          lastUpdate = now;
          await update(id, { progress: Math.min(99, Math.round(share * 100)) });
        },
      },
      partial,
      coverPartial,
    );

    const size = statSync(partial).size + (coverPartial ? statSync(coverPartial).size : 0);
    // Deleted while it was being made: nothing to keep, not even its links.
    if (!(await getRow(id))) {
      removePartials();
      await shareService.releaseExportLinks(row, false);
      return;
    }
    await reserveStorage(size);
    renameSync(partial, exportPath(filename));
    if (coverPartial && coverFilename) renameSync(coverPartial, exportPath(coverFilename));
    const done = await update(id, {
      status: "done",
      progress: 100,
      filename,
      cover_filename: coverFilename,
      file_size: size,
      page_count: result.pages,
      warnings: JSON.stringify(result.warnings),
      finished_at: Date.now(),
      album_updated_at: Number(album.updated_at),
    });
    if (!done) {
      // Deleted in the last moment.
      rmSync(exportPath(filename), { force: true });
      if (coverFilename) rmSync(exportPath(coverFilename), { force: true });
      await releaseStorage(size);
      await shareService.releaseExportLinks(row, false);
    }
    emit({ topic: topics.storageStats(), kind: "updated" });
  } catch (err) {
    removePartials();
    const code = err instanceof AppError ? err.code : "export_failed";
    if (!(err instanceof AppError)) console.error("[export] failed", { id, err });
    // No PDF, so no QR codes that would need its links.
    await shareService.releaseExportLinks(row, false);
    await update(id, { status: "failed", error_code: code, finished_at: Date.now() });
  }
}
