import type { AlbumDetail } from "@sammelband/shared";
import type { Album } from "../db/schema";
import { fail, must } from "../lib/errors";
import { emit, emitAlbumPatch, type PhotoWithImage, topics } from "../lib/events";
import { shortId } from "../lib/short-id";
import { currentTenantId, tdb } from "../lib/tenant-context";
import * as exportService from "./export.service";
import * as imageService from "./image.service";
import * as sectionService from "./section.service";
import * as sortService from "./sort.service";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function getAlbum(id: string): Promise<Album | null> {
  return (
    (await tdb().selectFrom("albums").selectAll().where("id", "=", id).executeTakeFirst()) ?? null
  );
}

async function folderExists(id: string): Promise<boolean> {
  return !!(await tdb().selectFrom("folders").select("id").where("id", "=", id).executeTakeFirst());
}

/**
 * Find an album by URL ref: "<slug>-<shortId>" or a bare shortId. Only the
 * shortId decides; the slug part is cosmetic, so links keep working after a
 * rename. The client redirects to the canonical ref.
 */
export async function resolveAlbum(ref: string): Promise<Album | null> {
  const short = ref.slice(ref.lastIndexOf("-") + 1);
  return (
    (await tdb()
      .selectFrom("albums")
      .selectAll()
      .where("short_id", "=", short)
      .executeTakeFirst()) ?? null
  );
}

async function uniqueShortId(): Promise<string> {
  while (true) {
    const id = shortId();
    const taken = await tdb()
      .selectFrom("albums")
      .select("id")
      .where("short_id", "=", id)
      .executeTakeFirst();
    if (!taken) return id;
  }
}

export async function getAlbumBySlug(slug: string, folderId: string | null): Promise<Album | null> {
  return (
    (await tdb()
      .selectFrom("albums")
      .selectAll()
      .where("slug", "=", slug)
      .where("folder_id", folderId === null ? "is" : "=", folderId)
      .executeTakeFirst()) ?? null
  );
}

export function listAlbums(): Promise<Album[]> {
  return tdb().selectFrom("albums").selectAll().orderBy("created_at", "desc").execute();
}

export async function createAlbum(input: {
  title: string;
  description?: string | null;
  folderId: string | null;
  createdBy: string;
}): Promise<Album> {
  if (!input.title.trim()) throw fail("title_required");
  if (input.folderId && !(await folderExists(input.folderId))) {
    throw fail("folder_not_found");
  }

  const baseSlug = slugify(input.title) || "untitled";
  const slug = await ensureUniqueSlug(baseSlug, input.folderId);

  const id = Bun.randomUUIDv7();
  const now = Date.now();
  await tdb()
    .insertInto("albums")
    .values({
      id,
      tenant_id: currentTenantId(),
      title: input.title.trim(),
      slug,
      short_id: await uniqueShortId(),
      description: input.description ?? null,
      folder_id: input.folderId,
      cover_photo_id: null,
      cover_filename: null,
      created_by: input.createdBy,
      created_at: now,
      updated_at: now,
    })
    .execute();
  const album = must(await getAlbum(id), "Album");
  emit({ topic: topics.albumList(), kind: "created", id, data: album });
  emit({ topic: topics.album(id), kind: "created", id, data: album });
  if (album.folder_id) {
    emit({ topic: topics.folder(album.folder_id), kind: "updated" });
  }
  return album;
}

/** First free slug of "base", "base-2", "base-3", … in the folder, ignoring `excludeId`. */
async function ensureUniqueSlug(
  base: string,
  folderId: string | null,
  excludeId?: string,
): Promise<string> {
  let candidate = base;
  let n = 2;
  while (true) {
    const existing = await getAlbumBySlug(candidate, folderId);
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${n++}`;
  }
}

export async function updateAlbum(
  id: string,
  patch: {
    title?: string;
    description?: string | null;
    folderId?: string | null;
  },
): Promise<Album> {
  const album = await getAlbum(id);
  if (!album) throw fail("album_not_found");

  let newFolderId = album.folder_id;
  if (patch.folderId !== undefined) {
    if (patch.folderId && !(await folderExists(patch.folderId))) {
      throw fail("folder_not_found");
    }
    newFolderId = patch.folderId;
  }

  let newSlug = album.slug;
  if (patch.title || newFolderId !== album.folder_id) {
    const baseSlug = slugify(patch.title ?? album.title) || album.slug;
    // Only re-uniquify if base changed or we moved folder.
    if (baseSlug !== album.slug || newFolderId !== album.folder_id) {
      newSlug = await ensureUniqueSlug(baseSlug, newFolderId, id);
    }
  }

  await tdb()
    .updateTable("albums")
    .set({
      title: patch.title?.trim() ?? album.title,
      slug: newSlug,
      description: patch.description !== undefined ? patch.description : album.description,
      folder_id: newFolderId,
      updated_at: Date.now(),
    })
    .where("id", "=", id)
    .execute();
  if (newFolderId !== album.folder_id) await sortService.dropPositions("album", id);
  const updated = must(await getAlbum(id), "Album");
  emitAlbumPatch(id, { album: updated });
  emit({ topic: topics.albumList(), kind: "updated", id });
  if (album.folder_id && album.folder_id !== updated.folder_id) {
    emit({ topic: topics.folder(album.folder_id), kind: "updated" });
  }
  if (updated.folder_id && updated.folder_id !== album.folder_id) {
    emit({ topic: topics.folder(updated.folder_id), kind: "updated" });
  }
  return updated;
}

export async function setCover(albumId: string, photoId: string | null): Promise<Album> {
  const album = await getAlbum(albumId);
  if (!album) throw fail("album_not_found");
  if (photoId !== null) {
    const photo = await tdb()
      .selectFrom("photos")
      .select("id")
      .where("id", "=", photoId)
      .where("album_id", "=", albumId)
      .executeTakeFirst();
    if (!photo) throw fail("photo_not_in_album");
  }
  await tdb()
    .updateTable("albums")
    .set({ cover_photo_id: photoId })
    .where("id", "=", albumId)
    .execute();
  await imageService.albumChanged(albumId);
  const updated = must(await getAlbum(albumId), "Album");
  emitAlbumPatch(albumId, { album: updated });
  emit({ topic: topics.albumList(), kind: "updated", id: albumId });
  return updated;
}

export async function deleteAlbum(id: string): Promise<void> {
  const album = await getAlbum(id);
  if (!album) throw fail("album_not_found");
  // Remove all photos from disk + variant cache first (dedup-aware); sections then
  // cascade via FK ON DELETE CASCADE when the album row is gone.
  await imageService.deletePhotosByAlbum(id);
  await exportService.deleteExportsByAlbum(id);
  await tdb().deleteFrom("albums").where("id", "=", id).execute();
  emit({ topic: topics.album(id), kind: "deleted", id });
  emit({ topic: topics.albumList(), kind: "deleted", id });
  if (album.folder_id) {
    emit({ topic: topics.folder(album.folder_id), kind: "updated" });
  }
}

export type { PhotoWithImage };

/** Album + ordered sections + photos (with image metadata + placeholder), by URL ref. */
export async function getAlbumDetail(ref: string): Promise<AlbumDetail> {
  const album = await resolveAlbum(ref);
  if (!album) throw fail("album_not_found");
  const sections = await sectionService.listSections(album.id);
  const photos = await imageService.photosWithImage({ albumId: album.id });
  return { album, sections, photos };
}
