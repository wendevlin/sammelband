import { mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import {
  type AlbumExport,
  type ExportFormat,
  type ExportOptions,
  type ExportPurpose,
  PAGE_FORMATS,
  PURPOSES,
} from "@sammelband/shared";
import { z } from "zod";
import { db } from "../db/client";
import type { AlbumExportRow } from "../db/schema";
import { AppError, fail, must } from "../lib/errors";
import { emit, topics } from "../lib/events";
import { createJobQueue } from "../lib/job-queue";
import { exportPath, exportsDir, originalPath } from "../lib/storage-paths";
import { currentTenantId, runInTenant, tdb } from "../lib/tenant-context";
import * as imageService from "./image.service";
import type { LayoutPhoto } from "./pdf/layout";
import { renderAlbumPdf } from "./pdf/render";
import * as sectionService from "./section.service";
import { releaseStorage, reserveStorage } from "./tenant.service";

// PDF exports of albums. Creating one queues a job; the job lays out and
// renders the PDF in the background (pdf/), stores it under the tenant's
// exports/ and counts it against the quota. The file stays until someone
// deletes it, or the album. Progress goes out as change events, so the
// export dialog and the list of exports follow along.

// `options` JSON. Exports made before the purposes had a `quality` instead:
// "print" meant a PDF with margins (now "home"), "screen" the same as now.
const optionsSchema = z
  .object({
    purpose: z.enum(["home", "print", "screen"]).optional(),
    quality: z.enum(["print", "screen"]).optional(),
    captions: z.boolean().catch(true),
  })
  .transform(
    ({ purpose, quality, captions }): ExportOptions => ({
      purpose: purpose ?? (quality === "screen" ? "screen" : "home"),
      captions,
    }),
  );

function toExport(row: AlbumExportRow): AlbumExport {
  let options: ExportOptions;
  try {
    options = optionsSchema.parse(JSON.parse(row.options));
  } catch {
    options = { purpose: "home", captions: true };
  }
  return {
    id: row.id,
    album_id: row.album_id,
    name: row.name,
    format: row.format as ExportFormat,
    options,
    status: row.status as AlbumExport["status"],
    progress: row.progress,
    error_code: row.error_code,
    page_count: row.page_count,
    file_size: row.file_size === null ? null : Number(row.file_size),
    created_by: row.created_by,
    created_at: Number(row.created_at),
    finished_at: row.finished_at === null ? null : Number(row.finished_at),
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

function changed(row: AlbumExportRow, kind: "created" | "updated" | "deleted" = "updated") {
  emit({ topic: topics.albumExports(row.album_id), kind, id: row.id, data: toExport(row) });
}

async function update(
  id: string,
  changes: Partial<AlbumExportRow>,
): Promise<AlbumExportRow | null> {
  await tdb().updateTable("album_exports").set(changes).where("id", "=", id).execute();
  const row = await getRow(id);
  if (row) changed(row);
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
  return rows.map(toExport);
}

async function exportEnabled(): Promise<boolean> {
  const tenant = await db
    .selectFrom("tenants")
    .select("pdf_export_enabled")
    .where("id", "=", currentTenantId())
    .executeTakeFirst();
  return Boolean(tenant?.pdf_export_enabled);
}

/** Queue an export of an album; returns at once, the PDF follows in the background. */
export async function createExport(
  albumId: string,
  userId: string,
  input: { format: ExportFormat; purpose: ExportPurpose; captions: boolean },
): Promise<AlbumExport> {
  if (!(await exportEnabled())) throw fail("export_disabled");
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
    format: input.format,
    options: JSON.stringify({ purpose: input.purpose, captions: input.captions }),
    status: "queued",
    progress: 0,
    error_code: null,
    page_count: null,
    file_size: null,
    filename: null,
    created_by: userId,
    created_at: Date.now(),
    finished_at: null,
  };
  await tdb().insertInto("album_exports").values(row).execute();
  changed(row, "created");
  queue.enqueue({ tenantId: row.tenant_id, id: row.id });
  return toExport(row);
}

export async function renameExport(id: string, name: string): Promise<AlbumExport> {
  const trimmed = name.trim();
  if (!trimmed) throw fail("name_required");
  await requireRow(id);
  return toExport(must(await update(id, { name: trimmed }), "Export"));
}

/** Remove the row and its file; a running job notices and throws its work away. */
export async function deleteExport(id: string): Promise<void> {
  const row = await requireRow(id);
  await tdb().deleteFrom("album_exports").where("id", "=", id).execute();
  await removeFile(row);
  changed(row, "deleted");
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
  if (row.status === "done" && row.file_size) {
    await releaseStorage(Number(row.file_size));
    emit({ topic: topics.storageStats(), kind: "updated" });
  }
}

/** The finished PDF, as a download named after the export. */
export async function downloadExport(id: string): Promise<Response> {
  const row = await requireRow(id);
  if (row.status !== "done" || !row.filename) throw fail("export_not_ready");
  const file = Bun.file(exportPath(row.filename));
  if (!(await file.exists())) throw fail("export_not_found");
  return new Response(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(`${row.name}.pdf`),
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
  const format = PAGE_FORMATS[row.format as ExportFormat];
  const options = toExport(row).options;
  const filename = `${Bun.randomUUIDv7()}.pdf`;
  const partial = exportPath(`${filename}.part`);
  try {
    if (!format) throw fail("export_failed");
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
        format,
        captions: options.captions,
        purpose: PURPOSES[options.purpose],
        original: (photoId) => originalPath(must(filenames.get(photoId), "Photo")),
        onProgress: async (share) => {
          const now = Date.now();
          if (now - lastUpdate < PROGRESS_INTERVAL) return;
          lastUpdate = now;
          await update(id, { progress: Math.min(99, Math.round(share * 100)) });
        },
      },
      partial,
    );

    const size = statSync(partial).size;
    // Deleted while it was being made: nothing to keep.
    if (!(await getRow(id))) {
      rmSync(partial, { force: true });
      return;
    }
    await reserveStorage(size);
    renameSync(partial, exportPath(filename));
    const done = await update(id, {
      status: "done",
      progress: 100,
      filename,
      file_size: size,
      page_count: result.pages,
      finished_at: Date.now(),
    });
    if (!done) {
      // Deleted in the last moment.
      rmSync(exportPath(filename), { force: true });
      await releaseStorage(size);
    }
    emit({ topic: topics.storageStats(), kind: "updated" });
  } catch (err) {
    rmSync(partial, { force: true });
    const code = err instanceof AppError ? err.code : "export_failed";
    if (!(err instanceof AppError)) console.error("[export] failed", { id, err });
    await update(id, { status: "failed", error_code: code, finished_at: Date.now() });
  }
}
