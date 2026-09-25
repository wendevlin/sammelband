import { randomBytes } from "node:crypto";
import { db } from "../db/client";
import type { ShareLink } from "../db/schema";
import { AppError } from "../lib/errors";
import { emit } from "../lib/events";

export type ValidationResult =
  | { valid: true; link: ShareLink }
  | { valid: false; reason: "not_found" | "revoked" | "expired" }
  | { valid: false; reason: "password_required" | "wrong_password" };

function generateToken(): string {
  // 24 bytes → 32 chars base64url, ~192 bits of entropy.
  return randomBytes(24).toString("base64url");
}

export async function createShareLink(input: {
  albumId?: string | null;
  folderId?: string | null;
  createdBy: string;
  password?: string;
  expiresAt?: number | null;
}): Promise<ShareLink> {
  if (!input.albumId === !input.folderId) {
    throw new AppError(400, "Provide exactly one of albumId or folderId");
  }

  if (input.albumId) {
    const album = db.query("SELECT shareable FROM albums WHERE id = ?").get(input.albumId) as {
      shareable: number;
    } | null;
    if (!album) throw new AppError(404, "Album not found");
    if (!album.shareable) {
      throw new AppError(409, "Album is not marked shareable");
    }
  }
  if (input.folderId) {
    if (!db.query("SELECT 1 FROM folders WHERE id = ?").get(input.folderId)) {
      throw new AppError(404, "Folder not found");
    }
  }

  const token = generateToken();
  const passwordHash = input.password
    ? await Bun.password.hash(input.password, { algorithm: "argon2id" })
    : null;
  const id = Bun.randomUUIDv7();
  const now = Date.now();

  db.run(
    `INSERT INTO share_links
       (id, token, album_id, folder_id, created_by, password_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      token,
      input.albumId ?? null,
      input.folderId ?? null,
      input.createdBy,
      passwordHash,
      input.expiresAt ?? null,
      now,
    ],
  );
  const link = getShareLinkById(id)!;
  emit({
    topic: shareTopicFor(link),
    kind: "created",
    id: link.id,
    data: redact(link),
  });
  return link;
}

function getShareLinkById(id: string): ShareLink | null {
  return db.query("SELECT * FROM share_links WHERE id = ?").get(id) as ShareLink | null;
}

export function getShareLinkByToken(token: string): ShareLink | null {
  return db.query("SELECT * FROM share_links WHERE token = ?").get(token) as ShareLink | null;
}

export function listShareLinks(opts: { albumId?: string; folderId?: string }): ShareLink[] {
  if (opts.albumId) {
    return db
      .query("SELECT * FROM share_links WHERE album_id = ? ORDER BY created_at DESC")
      .all(opts.albumId) as ShareLink[];
  }
  if (opts.folderId) {
    return db
      .query("SELECT * FROM share_links WHERE folder_id = ? ORDER BY created_at DESC")
      .all(opts.folderId) as ShareLink[];
  }
  throw new AppError(400, "Provide albumId or folderId");
}

export function revokeShareLink(token: string): void {
  const link = getShareLinkByToken(token);
  if (!link) throw new AppError(404, "Share link not found");
  db.run("UPDATE share_links SET revoked_at = ? WHERE id = ?", [Date.now(), link.id]);
  emit({ topic: shareTopicFor(link), kind: "deleted", id: link.id });
}

export function shareTopicFor(link: { album_id: string | null; folder_id: string | null }): string {
  if (link.album_id) return `share-links:album:${link.album_id}`;
  if (link.folder_id) return `share-links:folder:${link.folder_id}`;
  throw new Error("share link has no resource");
}

export async function validateShareAccess(
  token: string,
  password?: string,
): Promise<ValidationResult> {
  const link = getShareLinkByToken(token);
  if (!link) return { valid: false, reason: "not_found" };
  if (link.revoked_at) return { valid: false, reason: "revoked" };
  if (link.expires_at && link.expires_at < Date.now()) {
    return { valid: false, reason: "expired" };
  }
  if (link.password_hash) {
    if (!password) return { valid: false, reason: "password_required" };
    const ok = await Bun.password.verify(password, link.password_hash);
    if (!ok) return { valid: false, reason: "wrong_password" };
  }
  return { valid: true, link };
}

/** Hide password_hash from API responses (it's a hash, but no reason to leak it). */
export function redact(link: ShareLink) {
  const { password_hash, ...rest } = link;
  return { ...rest, has_password: password_hash !== null };
}
