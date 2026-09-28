import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { db } from "../db/client";
import type { AlbumBlock, Folder, ShareLink } from "../db/schema";
import { AppError } from "../lib/errors";
import type { PhotoWithImage } from "../lib/events";
import { runInTenant, tdb } from "../lib/tenant-context";
import * as albumService from "./album.service";
import * as folderService from "./folder.service";
import * as imageService from "./image.service";

// The visitor side of public links: no account, access to exactly one album or
// one folder subtree. Everything runs inside the link's tenant and returns
// only what a viewer needs (no user ids, no tenant ids). Images are served as
// resized versions only, never the originals.

const INVALID = "This link is invalid or has expired";
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
    throw new AppError(404, INVALID);
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
    throw new AppError(401, "Wrong password");
  }
  return { name: unlockCookieName(share), ...unlockValue(share) };
}

// --- Content ----------------------------------------------------------------------

type PublicAlbum = { id: string; title: string; description: string | null; short_id: string };
type PublicBlock = Pick<AlbumBlock, "id" | "parent_id" | "sort_order" | "type" | "content">;
type PublicPhoto = Pick<
  PhotoWithImage,
  "id" | "block_id" | "sort_order" | "caption" | "filename" | "width" | "height" | "placeholder"
>;
type PublicTile = {
  id: string;
  name: string;
  covers: string[];
  album_count: number;
  folder_count: number;
};
type PublicAlbumCard = PublicAlbum & { cover_filename: string | null };
type Crumb = { id: string; name: string };

export type SharedView =
  | { status: "locked" }
  | {
      status: "ok";
      kind: "album";
      album: PublicAlbum;
      blocks: PublicBlock[];
      photos: PublicPhoto[];
      /** Folders from the shared folder down to this album (folder shares only). */
      trail: Crumb[];
    }
  | {
      status: "ok";
      kind: "folder";
      folder: Crumb;
      folders: PublicTile[];
      albums: PublicAlbumCard[];
      /** Folders from the shared folder down to this one. */
      trail: Crumb[];
    };

const publicAlbum = (a: PublicAlbum): PublicAlbum => ({
  id: a.id,
  title: a.title,
  description: a.description,
  short_id: a.short_id,
});

/**
 * The folder's path from the shared root folder, or null when it's outside
 * the shared subtree.
 */
async function trailWithin(rootId: string, folderId: string | null): Promise<Crumb[] | null> {
  const chain: Crumb[] = [];
  let current: Folder | null = folderId ? await folderService.getFolder(folderId) : null;
  while (current) {
    chain.unshift({ id: current.id, name: current.name });
    if (current.id === rootId) return chain;
    current = current.parent_id ? await folderService.getFolder(current.parent_id) : null;
  }
  return null;
}

async function albumView(ref: string, trail: Crumb[]): Promise<SharedView> {
  const { album, blocks, photos } = await albumService.getAlbumDetail(ref);
  return {
    status: "ok",
    kind: "album",
    album: publicAlbum(album),
    blocks: blocks.map(({ id, parent_id, sort_order, type, content }) => ({
      id,
      parent_id,
      sort_order,
      type,
      content,
    })),
    photos: photos.map((p) => ({
      id: p.id,
      block_id: p.block_id,
      sort_order: p.sort_order,
      caption: p.caption,
      filename: p.filename,
      width: p.width,
      height: p.height,
      placeholder: p.placeholder,
    })),
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
    if (share.album_id) {
      const album = await albumService.getAlbum(share.album_id);
      if (!album || at.folderId || (at.albumRef && !sameAlbum(at.albumRef, album.short_id))) {
        throw new AppError(404, "Not part of this link");
      }
      return albumView(album.short_id, []);
    }
    const rootId = share.folder_id ?? "";
    if (at.albumRef) {
      const album = await albumService.resolveAlbum(at.albumRef);
      const trail = album && (await trailWithin(rootId, album.folder_id));
      if (!album || !trail) throw new AppError(404, "Not part of this link");
      return albumView(album.short_id, trail);
    }
    const folderId = at.folderId ?? rootId;
    const trail = await trailWithin(rootId, folderId);
    const folder = trail?.at(-1);
    if (!trail || !folder) throw new AppError(404, "Not part of this link");
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

/** All folder ids of the subtree below (and including) `rootId`. */
async function subtree(rootId: string): Promise<string[]> {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i++) {
    const children = await tdb()
      .selectFrom("folders")
      .select("id")
      .where("parent_id", "=", ids[i] ?? "")
      .execute();
    ids.push(...children.map((c) => c.id));
  }
  return ids;
}

/** A resized image, if it belongs to the shared album or folder subtree. */
export function image(
  { share, unlocked }: ShareAccess,
  filename: string,
  width: number,
  format: "webp" | "jpeg",
): Promise<Response> {
  if (!unlocked) throw new AppError(401, "This link is password protected");
  return runInTenant(share.tenant_id, async () => {
    let q = tdb()
      .selectFrom("photos as p")
      .innerJoin("image_files as i", "i.id", "p.image_file_id")
      .innerJoin("albums as a", "a.id", "p.album_id")
      .select("p.id")
      .where("i.filename", "=", filename);
    q = share.album_id
      ? q.where("a.id", "=", share.album_id)
      : q.where("a.folder_id", "in", await subtree(share.folder_id ?? ""));
    if (!(await q.executeTakeFirst())) throw new AppError(404, "Image not found");
    return imageService.serveVariant(filename, width, format);
  });
}
