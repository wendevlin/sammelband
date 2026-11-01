import { randomBytes } from "node:crypto";
import type { ShareLinkInfo } from "@sammelband/shared";
import { appUrl } from "../config";
import { fail } from "../lib/errors";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { endOfDayIn } from "../lib/timezone";
import { currentTenant } from "./tenant.service";

// Managing public links (signed-in side, confined to the current tenant). The
// visitor side is public.service.ts.
//
// Besides the links people create, every PDF export of an album with videos
// gets one: its QR codes lead there, and it shows only the album's videos.
// It belongs to the PDF (`export_id`): it can't be deleted on its own, and
// goes with the PDF unless whoever deletes the PDF keeps it (printed copies
// keep working), which makes it an ordinary link that can be deleted.

export type ShareTarget = { albumId: string } | { folderId: string };

const MIN_PASSWORD = 8;

export const shareUrl = (token: string) => appUrl(`/s/${token}`);

async function requireTarget(target: ShareTarget): Promise<void> {
  const found =
    "albumId" in target
      ? await tdb()
          .selectFrom("albums")
          .select("id")
          .where("id", "=", target.albumId)
          .executeTakeFirst()
      : await tdb()
          .selectFrom("folders")
          .select("id")
          .where("id", "=", target.folderId)
          .executeTakeFirst();
  if (!found) throw fail("albumId" in target ? "album_not_found" : "folder_not_found");
}

export async function listShares(target: ShareTarget): Promise<ShareLinkInfo[]> {
  await requireTarget(target);
  let q = tdb()
    .selectFrom("share_links as s")
    .leftJoin("user as u", "u.id", "s.created_by")
    .leftJoin("album_exports as e", "e.id", "s.export_id")
    .select([
      "s.id",
      "s.token",
      "s.password_hash",
      "s.expires_at",
      "s.created_at",
      "s.videos_only",
      "s.label",
      "e.id as export_id",
      "e.name as export_name",
      "u.name as created_by_name",
    ])
    .orderBy("s.created_at", "desc");
  q =
    "albumId" in target
      ? q.where("s.album_id", "=", target.albumId)
      : q.where("s.folder_id", "=", target.folderId);
  return (await q.execute()).map((r) => ({
    id: r.id,
    url: shareUrl(r.token),
    has_password: r.password_hash !== null,
    expires_at: r.expires_at,
    created_at: Number(r.created_at),
    created_by_name: r.created_by_name,
    videos_only: Boolean(r.videos_only),
    export: r.export_id && r.export_name ? { id: r.export_id, name: r.export_name } : null,
    label: r.label,
  }));
}

export async function createShare(
  target: ShareTarget,
  /** `expiresOn`: "YYYY-MM-DD"; the link works until the end of that day in the tenant's zone. */
  opts: { password?: string | null; expiresOn?: string | null },
  userId: string,
): Promise<ShareLinkInfo> {
  await requireTarget(target);
  const password = opts.password?.trim() || null;
  if (password && password.length < MIN_PASSWORD) {
    throw fail("share_password_too_short", { min: MIN_PASSWORD });
  }
  let expiresAt: number | null = null;
  if (opts.expiresOn) {
    const { timezone } = await currentTenant();
    expiresAt = endOfDayIn(opts.expiresOn, timezone);
    if (expiresAt <= Date.now()) throw fail("expiry_in_past");
  }
  const id = Bun.randomUUIDv7();
  const token = randomBytes(24).toString("base64url");
  await tdb()
    .insertInto("share_links")
    .values({
      id,
      tenant_id: currentTenantId(),
      token,
      album_id: "albumId" in target ? target.albumId : null,
      folder_id: "folderId" in target ? target.folderId : null,
      password_hash: password ? await Bun.password.hash(password) : null,
      expires_at: expiresAt,
      created_by: userId,
      created_at: Date.now(),
      export_id: null,
      videos_only: 0,
      label: null,
    })
    .execute();
  const created = (await listShares(target)).find((s) => s.id === id);
  if (!created) throw fail("internal_error");
  return created;
}

/** Revoke one link; other links to the same album or folder keep working. */
export async function deleteShare(id: string): Promise<void> {
  const link = await tdb()
    .selectFrom("share_links")
    .select("export_id")
    .where("id", "=", id)
    .executeTakeFirst();
  if (!link) throw fail("share_link_not_found");
  if (link.export_id) throw fail("share_link_of_export");
  await tdb().deleteFrom("share_links").where("id", "=", id).execute();
}

// --- The video links of PDF exports ---------------------------------------------------

/** The video link of a PDF export, made on first use. */
export async function videoLinkFor(exp: {
  id: string;
  album_id: string;
  created_by: string | null;
}): Promise<{ id: string; token: string }> {
  const existing = await tdb()
    .selectFrom("share_links")
    .select(["id", "token"])
    .where("export_id", "=", exp.id)
    .executeTakeFirst();
  if (existing) return existing;
  const link = { id: Bun.randomUUIDv7(), token: randomBytes(24).toString("base64url") };
  await tdb()
    .insertInto("share_links")
    .values({
      ...link,
      tenant_id: currentTenantId(),
      album_id: exp.album_id,
      folder_id: null,
      password_hash: null,
      expires_at: null,
      created_by: exp.created_by,
      created_at: Date.now(),
      export_id: exp.id,
      videos_only: 1,
      label: null,
    })
    .execute();
  return link;
}

/** The address of one video behind a PDF's link, as its QR code holds it. */
export const videoUrl = (token: string, photoId: string) => `${shareUrl(token)}?v=${photoId}`;

/**
 * Before its PDF is deleted: delete its video link, or keep it as an
 * ordinary link (named after the PDF) that can be deleted later.
 */
export async function releaseVideoLink(
  exp: { id: string; name: string },
  keep: boolean,
): Promise<void> {
  if (keep) {
    await tdb()
      .updateTable("share_links")
      .set({ export_id: null, label: exp.name })
      .where("export_id", "=", exp.id)
      .execute();
  } else {
    await tdb().deleteFrom("share_links").where("export_id", "=", exp.id).execute();
  }
}
