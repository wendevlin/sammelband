import { db } from "../db/client";
import { fail } from "../lib/errors";
import { currentTenantId } from "../lib/tenant-context";

// Who must use two-factor authentication: everyone in a tenant whose admins
// require it, or everyone on the instance when the superadmin does. The codes
// themselves are better-auth's twoFactor plugin (/api/auth/two-factor/*).
// Instance-level, so plain `db` with explicit filters.

const INSTANCE_KEY = "two_factor_required";

export async function requiredByInstance(): Promise<boolean> {
  const row = await db
    .selectFrom("instance_settings")
    .select("value")
    .where("key", "=", INSTANCE_KEY)
    .executeTakeFirst();
  return row ? JSON.parse(row.value) === true : false;
}

/** Whether users of this tenant have to set up two-factor authentication. */
export async function isRequired(tenantId: string): Promise<boolean> {
  const tenant = await db
    .selectFrom("tenants")
    .select("two_factor_required")
    .where("id", "=", tenantId)
    .executeTakeFirst();
  return Boolean(tenant?.two_factor_required) || (await requiredByInstance());
}

/**
 * Only someone who uses two-factor authentication may require it of others;
 * otherwise their own next request would send them to the setup page.
 */
function checkActor(actor: { twoFactorEnabled: boolean }, required: boolean): void {
  if (required && !actor.twoFactorEnabled) throw fail("two_factor_own_first");
}

/** Tenant admin: require two-factor authentication in the current tenant. */
export async function setRequiredForTenant(
  actor: { twoFactorEnabled: boolean },
  required: boolean,
): Promise<void> {
  checkActor(actor, required);
  await db
    .updateTable("tenants")
    .set({ two_factor_required: required ? 1 : 0 })
    .where("id", "=", currentTenantId())
    .execute();
}

/** Superadmin: require two-factor authentication of every user on the instance. */
export async function setRequiredForInstance(
  actor: { twoFactorEnabled: boolean },
  required: boolean,
): Promise<void> {
  checkActor(actor, required);
  const value = JSON.stringify(required);
  await db
    .insertInto("instance_settings")
    .values({ key: INSTANCE_KEY, value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
}
