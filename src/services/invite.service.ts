import { randomBytes } from "node:crypto";
import { appUrl } from "../config";
import { db } from "../db/client";
import { fail } from "../lib/errors";
import { currentTenantId, tdb } from "../lib/tenant-context";
import { createAccount, type Role } from "./user.service";

// One-time links that let someone create their own account in a tenant. The
// superadmin gets one for the first admin of a new Sammelband; tenant admins
// create them for their users. Only a hash of the token is stored.

const VALID_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export type CreatedInvite = { url: string; role: Role; expiresAt: number };

function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/**
 * Create an invite for `tenantId`. Not tenant-scoped: the tenant service calls
 * it for any tenant (superadmin), createTenantInvite() for the current one.
 * A new admin invite from the superadmin replaces older unused ones.
 */
export async function createInvite(
  tenantId: string,
  role: Role,
  opts: { replaceUnused?: boolean } = {},
): Promise<CreatedInvite> {
  if (opts.replaceUnused) {
    await db
      .deleteFrom("tenant_invites")
      .where("tenant_id", "=", tenantId)
      .where("role", "=", role)
      .where("used_at", "is", null)
      .execute();
  }
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  const expiresAt = now + VALID_FOR_MS;
  await db
    .insertInto("tenant_invites")
    .values({
      id: Bun.randomUUIDv7(),
      tenant_id: tenantId,
      token_hash: hashToken(token),
      role,
      expires_at: expiresAt,
      used_at: null,
      created_at: now,
    })
    .execute();
  return { url: appUrl(`/invite/${token}`), role, expiresAt };
}

/** Tenant admin: invite someone into the current tenant. */
export function createTenantInvite(role: Role): Promise<CreatedInvite> {
  return createInvite(currentTenantId(), role);
}

/** Tenant admin: drop all unused invites of the current tenant. */
export async function revokeTenantInvites(): Promise<void> {
  await tdb().deleteFrom("tenant_invites").where("used_at", "is", null).execute();
}

async function findUsable(token: string) {
  const invite = await db
    .selectFrom("tenant_invites")
    .innerJoin("tenants", "tenants.id", "tenant_invites.tenant_id")
    .select([
      "tenant_invites.id",
      "tenant_invites.tenant_id",
      "tenant_invites.role",
      "tenant_invites.expires_at",
      "tenant_invites.used_at",
      "tenants.name as tenant_name",
      "tenants.suspended_at",
    ])
    .where("tenant_invites.token_hash", "=", hashToken(token))
    .executeTakeFirst();
  // One message for every unusable state, so tokens can't be probed.
  if (!invite || invite.used_at || invite.expires_at < Date.now() || invite.suspended_at) {
    throw fail("invite_invalid");
  }
  return invite;
}

/** Public: what an invite link leads to. */
export async function describeInvite(token: string): Promise<{ sammelband: string; role: Role }> {
  const invite = await findUsable(token);
  return { sammelband: invite.tenant_name, role: invite.role };
}

/**
 * Public: create an account through an invite link. The link is used up.
 * Admin invites may also rename the Sammelband (`sammelband`); user invites
 * ignore it.
 */
export async function acceptInvite(
  token: string,
  input: { email: string; name: string; password: string; sammelband?: string },
): Promise<{ ok: true }> {
  const invite = await findUsable(token);
  // Claim the invite first so two requests can't both use it.
  const claimed = await db
    .updateTable("tenant_invites")
    .set({ used_at: Date.now() })
    .where("id", "=", invite.id)
    .where("used_at", "is", null)
    .executeTakeFirst();
  if (Number(claimed.numUpdatedRows) !== 1) {
    throw fail("invite_invalid");
  }
  try {
    const { sammelband, ...account } = input;
    await createAccount({ ...account, tenantId: invite.tenant_id, role: invite.role });
    const rename = sammelband?.trim();
    if (invite.role === "admin" && rename && rename !== invite.tenant_name) {
      await db
        .updateTable("tenants")
        .set({ name: rename })
        .where("id", "=", invite.tenant_id)
        .execute();
    }
  } catch (err) {
    await db
      .updateTable("tenant_invites")
      .set({ used_at: null })
      .where("id", "=", invite.id)
      .execute();
    throw err;
  }
  return { ok: true };
}
