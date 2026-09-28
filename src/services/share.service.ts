import { randomBytes } from "node:crypto";
import { appUrl } from "../config";
import { fail } from "../lib/errors";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { endOfDayIn } from "../lib/timezone";
import { currentTenant } from "./tenant.service";

// Managing public links (signed-in side, confined to the current tenant). The
// visitor side is public.service.ts.

export type ShareTarget = { albumId: string } | { folderId: string };

export type ShareLinkInfo = {
  id: string;
  url: string;
  has_password: boolean;
  expires_at: number | null;
  created_at: number;
  created_by_name: string | null;
};

const MIN_PASSWORD = 4;

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
    .select([
      "s.id",
      "s.token",
      "s.password_hash",
      "s.expires_at",
      "s.created_at",
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
    created_at: r.created_at,
    created_by_name: r.created_by_name,
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
    })
    .execute();
  const created = (await listShares(target)).find((s) => s.id === id);
  if (!created) throw fail("internal_error");
  return created;
}

/** Revoke one link; other links to the same album or folder keep working. */
export async function deleteShare(id: string): Promise<void> {
  const result = await tdb().deleteFrom("share_links").where("id", "=", id).executeTakeFirst();
  if (Number(result.numDeletedRows) === 0) throw fail("share_link_not_found");
}
