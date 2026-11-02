import { createHmac, timingSafeEqual } from "node:crypto";
import type { Crumb, Photo, SharedAlbum, SharedPhoto, SharedView } from "@sammelband/shared";
import { config } from "../config";
import { db } from "../db/client";
import type { Folder, ShareLink } from "../db/schema";
import { fail } from "../lib/errors";
import { runInTenant, tdb } from "../lib/tenant-context";
import * as albumService from "./album.service";
import * as folderService from "./folder.service";
import * as imageDelivery from "./image-delivery.service";
import * as videoService from "./video.service";

// The visitor side of public links: no account, access to exactly one album or
// one folder subtree. Everything runs inside the link's tenant and returns
// only what a viewer needs (no user ids, no tenant ids). Images are served as
// resized versions only, never the originals; videos as converted, the only
// form they are kept in. The video link of a PDF export (`videos_only`) shows
// the album's videos and nothing else.

const UNLOCK_DAYS = 7;

export type ShareAccess = { share: ShareLink; unlocked: boolean };

/** The link for `token`, if it exists, hasn't expired and its tenant isn't suspended. */
async function findShare(token: string): Promise<ShareLink> {
  const row = await db
    .selectFrom("share_links as s")
    .innerJoin("tenants as t", "t.id", "s.tenant_id")
    .selectAll("s")
    .select("t.suspended_at")
    .where("s.token", "=", token)
    .executeTakeFirst();
  if (!row || row.suspended_at || (row.expires_at !== null && row.expires_at < Date.now())) {
    throw fail("share_invalid");
  }
  const { suspended_at: _, ...share } = row;
  return share;
}

// --- Password unlock: a signed cookie per link ----------------------------------

export const unlockCookieName = (share: ShareLink) => `sb_share_${share.id}`;

// Bound to the password hash, so setting a new password invalidates old cookies.
function sign(share: ShareLink, expires: number): string {
  return createHmac("sha256", config.SECRET_KEY)
    .update(`${share.id}:${share.password_hash}:${expires}`)
    .digest("base64url");
}

function unlockValue(share: ShareLink): { value: string; maxAge: number } {
  const maxAge = UNLOCK_DAYS * 24 * 60 * 60;
  const expires = Date.now() + maxAge * 1000;
  return { value: `${expires}.${sign(share, expires)}`, maxAge };
}

function isUnlocked(share: ShareLink, cookie: string | undefined): boolean {
  if (!share.password_hash) return true;
  const [expires, signature] = (cookie ?? "").split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = Buffer.from(sign(share, Number(expires)));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Resolve a token and check its unlock cookie (read with `cookieFor`). */
export async function access(
  token: string,
  cookieFor: (name: string) => string | undefined,
): Promise<ShareAccess> {
  const share = await findShare(token);
  return { share, unlocked: isUnlocked(share, cookieFor(unlockCookieName(share))) };
}

/** Check the password; returns the cookie that unlocks the link. */
export async function unlock(
  token: string,
  password: string,
): Promise<{ name: string; value: string; maxAge: number }> {
  const share = await findShare(token);
  if (!share.password_hash || !(await Bun.password.verify(password, share.password_hash))) {
    throw fail("wrong_password");
  }
  return { name: unlockCookieName(share), ...unlockValue(share) };
}

// --- Content ----------------------------------------------------------------------

export type { SharedView };

const publicAlbum = (a: SharedAlbum): SharedAlbum => ({
  id: a.id,
  title: a.title,
  description: a.description,
  short_id: a.short_id,
});

/**
 * The folder's path from the shared root folder, or null when it's outside
 * the shared subtree. Walks up, so it costs one query per level.
 */
async function trailWithin(rootId: string, folderId: string | null): Promise<Crumb[] | null> {
  const chain: Crumb[] = [];
  const seen = new Set<string>();
  let current: Folder | null = folderId ? await folderService.getFolder(folderId) : null;
  // A folder seen twice would be a cycle. Moving a folder below itself is
  // refused, but a public request must never loop forever.
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift({ id: current.id, name: current.name });
    if (current.id === rootId) return chain;
    current = current.parent_id ? await folderService.getFolder(current.parent_id) : null;
  }
  return null;
}

const sharedPhoto = (p: Photo): SharedPhoto => ({
  id: p.id,
  section_id: p.section_id,
  sort_order: p.sort_order,
  caption: p.caption,
  filename: p.filename,
  width: p.width,
  height: p.height,
  placeholder: p.placeholder,
  kind: p.kind,
  duration_ms: p.duration_ms === null ? null : Number(p.duration_ms),
  video_filename: p.video_status === "ready" ? p.video_filename : null,
  video_status: p.video_status,
});

/** A PDF's video link: the album's videos in album order, nothing else. */
async function videosView(albumId: string): Promise<SharedView> {
  const album = await albumService.getAlbum(albumId);
  if (!album) throw fail("not_in_share");
  const { sections, photos } = await albumService.getAlbumDetail(album.short_id);
  const section = new Map(sections.map((s, i) => [s.id, i]));
  const videos = photos
    .filter((p) => p.kind === "video")
    .sort(
      (a, b) =>
        (section.get(a.section_id) ?? 0) - (section.get(b.section_id) ?? 0) ||
        a.sort_order - b.sort_order,
    );
  return {
    status: "ok",
    kind: "videos",
    album: publicAlbum(album),
    videos: videos.map(sharedPhoto),
  };
}

async function albumView(ref: string, trail: Crumb[]): Promise<SharedView> {
  const { album, sections, photos } = await albumService.getAlbumDetail(ref);
  return {
    status: "ok",
    kind: "album",
    album: publicAlbum(album),
    sections: sections.map(({ id, sort_order, title, text, highlight }) => ({
      id,
      sort_order,
      title,
      text,
      highlight,
    })),
    photos: photos.map(sharedPhoto),
    trail,
  };
}

/**
 * What a visitor sees: the shared album, or for folder shares the shared
 * folder, a sub-folder (`folderId`) or an album (`albumRef`) inside it.
 */
export function view(
  { share, unlocked }: ShareAccess,
  at: { albumRef?: string; folderId?: string },
): Promise<SharedView> {
  if (!unlocked) return Promise.resolve({ status: "locked" });
  return runInTenant(share.tenant_id, async (): Promise<SharedView> => {
    if (share.videos_only) {
      if (!share.album_id || at.albumRef || at.folderId) throw fail("not_in_share");
      return videosView(share.album_id);
    }
    if (share.album_id) {
      const album = await albumService.getAlbum(share.album_id);
      if (!album || at.folderId || (at.albumRef && !sameAlbum(at.albumRef, album.short_id))) {
        throw fail("not_in_share");
      }
      return albumView(album.short_id, []);
    }
    const rootId = share.folder_id ?? "";
    if (at.albumRef) {
      const album = await albumService.resolveAlbum(at.albumRef);
      const trail = album && (await trailWithin(rootId, album.folder_id));
      if (!album || !trail) throw fail("not_in_share");
      return albumView(album.short_id, trail);
    }
    const folderId = at.folderId ?? rootId;
    const trail = await trailWithin(rootId, folderId);
    const folder = trail?.at(-1);
    if (!trail || !folder) throw fail("not_in_share");
    // The folder in the order its creator sees it.
    const contents = await folderService.contentsOf(folderId, share.created_by);
    return {
      status: "ok",
      kind: "folder",
      folder,
      folders: contents.folders.map((f) => ({
        id: f.id,
        name: f.name,
        covers: f.covers,
        album_count: f.album_count,
        folder_count: f.folder_count,
      })),
      albums: contents.albums.map((a) => ({ ...publicAlbum(a), cover_filename: a.cover_filename })),
      trail,
    };
  });
}

const sameAlbum = (ref: string, shortId: string) => ref.slice(ref.lastIndexOf("-") + 1) === shortId;

/** Whether one of these albums is the shared album or lies in the shared subtree. */
async function sharesAlbum(
  share: ShareLink,
  albums: { id: string; folder_id: string | null }[],
): Promise<boolean> {
  if (share.album_id) return albums.some((a) => a.id === share.album_id);
  for (const album of albums) {
    if (await trailWithin(share.folder_id ?? "", album.folder_id)) return true;
  }
  return false;
}

/**
 * The albums a file is in. Uploads of the same bytes share one file, so it
 * can be in several. Video links only ever show videos.
 */
function albumsWith(share: ShareLink, file: { filename: string } | { videoFilename: string }) {
  let q = tdb()
    .selectFrom("photos as p")
    .innerJoin("image_files as i", "i.id", "p.image_file_id")
    .innerJoin("albums as a", "a.id", "p.album_id")
    .select(["a.id", "a.folder_id"])
    .distinct();
  q =
    "filename" in file
      ? q.where("i.filename", "=", file.filename)
      : q.where("i.video_filename", "=", file.videoFilename);
  if (share.videos_only) q = q.where("i.kind", "=", "video");
  return q.execute();
}

/** A resized image, if it belongs to the shared album or folder subtree. */
export function image(
  { share, unlocked }: ShareAccess,
  filename: string,
  width: number,
  format: "webp" | "jpeg",
): Promise<Response> {
  if (!unlocked) throw fail("share_locked");
  return runInTenant(share.tenant_id, async () => {
    if (!(await sharesAlbum(share, await albumsWith(share, { filename })))) {
      throw fail("image_not_found");
    }
    return imageDelivery.serveVariant(filename, width, format);
  });
}

/** A video (in parts, see lib/range.ts), if it belongs to the shared album or folder subtree. */
export function video(
  { share, unlocked }: ShareAccess,
  filename: string,
  range: string | undefined,
): Promise<Response> {
  if (!unlocked) throw fail("share_locked");
  return runInTenant(share.tenant_id, async () => {
    const albums = await albumsWith(share, { videoFilename: filename });
    if (!(await sharesAlbum(share, albums))) throw fail("video_not_found");
    return videoService.serveVideo(filename, range);
  });
}

// --- Link previews (WhatsApp, Telegram, …) ------------------------------------------

export type LinkPreview = {
  title: string;
  description: string;
  /** Absolute URL of a resized JPEG, with its size. */
  image: { url: string; width: number; height: number } | null;
};

const PREVIEW_WIDTH = 1200;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * What messengers show for a link. Their preview bots fetch the HTML without
 * running JavaScript or holding a cookie, so the backend puts this into the
 * page. Password links get a neutral preview: no title, no photo.
 */
export async function linkPreview(
  token: string,
  at: { albumRef?: string; folderId?: string },
): Promise<LinkPreview | null> {
  let share: ShareLink;
  try {
    share = await findShare(token);
  } catch {
    return null;
  }
  if (share.password_hash) {
    return {
      title: "Password-protected link",
      description: "Shared on Sammelband",
      image: null,
    };
  }
  const shown = await view({ share, unlocked: true }, at).catch(() => null);
  if (shown?.status !== "ok") return null;

  let title: string;
  let description: string;
  let cover: string | null;
  if (shown.kind === "album") {
    title = shown.album.title;
    description = shown.album.description || plural(shown.photos.length, "photo");
    cover = await runInTenant(
      share.tenant_id,
      async () => (await albumService.getAlbum(shown.album.id))?.cover_filename ?? null,
    );
  } else if (shown.kind === "videos") {
    title = shown.album.title;
    description = plural(shown.videos.length, "video");
    // Video links show nothing but the videos: the first one's poster.
    cover = shown.videos[0]?.filename ?? null;
  } else {
    title = shown.folder.name;
    const parts = [
      shown.albums.length > 0 && plural(shown.albums.length, "album"),
      shown.folders.length > 0 && plural(shown.folders.length, "folder"),
    ].filter(Boolean);
    description = parts.join(" · ") || "Shared on Sammelband";
    cover =
      shown.albums.find((a) => a.cover_filename)?.cover_filename ??
      shown.folders.find((f) => f.covers.length > 0)?.covers[0] ??
      null;
  }

  const image = cover
    ? await runInTenant(share.tenant_id, () =>
        tdb()
          .selectFrom("image_files")
          .select(["width", "height"])
          .where("filename", "=", cover)
          .executeTakeFirst(),
      )
    : undefined;
  return {
    title,
    description,
    image:
      cover && image
        ? {
            url: new URL(
              `/api/public/${token}/images/${cover}?w=${PREVIEW_WIDTH}&format=jpeg`,
              config.BASE_URL,
            ).href,
            // Variants are always scaled to the requested width.
            width: PREVIEW_WIDTH,
            height: Math.round((image.height * PREVIEW_WIDTH) / image.width),
          }
        : null,
  };
}
