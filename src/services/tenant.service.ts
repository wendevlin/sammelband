import { rmSync, statSync } from "node:fs";
import { sql } from "kysely";
import { config } from "../config";
import { db, dbType } from "../db/client";
import type { Tenant } from "../db/schema";
import { AppError, must } from "../lib/errors";
import { tenantDir } from "../lib/storage-paths";
import { currentTenantId } from "../lib/tenant-context";
import { type CreatedInvite, createInvite } from "./invite.service";

// Tenants ("Sammelbände"). The instance functions here are for the superadmin
// and work across tenants on purpose: they see names, counts and storage
// numbers, never content.

export type TenantInfo = Pick<Tenant, "id" | "name" | "quota_bytes" | "storage_used_bytes">;

async function getTenant(id: string): Promise<Tenant | null> {
  return (
    (await db.selectFrom("tenants").selectAll().where("id", "=", id).executeTakeFirst()) ?? null
  );
}

async function requireTenant(id: string): Promise<Tenant> {
  const tenant = await getTenant(id);
  if (!tenant) throw new AppError(404, "Sammelband not found");
  return tenant;
}

/** The signed-in user's tenant. */
export async function currentTenant(): Promise<TenantInfo> {
  const { id, name, quota_bytes, storage_used_bytes } = await requireTenant(currentTenantId());
  return { id, name, quota_bytes, storage_used_bytes };
}

/**
 * Count `bytes` of new originals against the current tenant's quota, or throw
 * 413. One conditional UPDATE, so concurrent uploads can't overshoot.
 */
export async function reserveStorage(bytes: number): Promise<void> {
  const result = await db
    .updateTable("tenants")
    .set((eb) => ({ storage_used_bytes: eb("storage_used_bytes", "+", bytes) }))
    .where("id", "=", currentTenantId())
    .where((eb) =>
      eb.or([
        eb("quota_bytes", "is", null),
        eb(eb("storage_used_bytes", "+", bytes), "<=", eb.ref("quota_bytes")),
      ]),
    )
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) !== 1) {
    throw new AppError(413, "Storage quota exceeded. Ask your admin for more space.");
  }
}

export async function releaseStorage(bytes: number): Promise<void> {
  if (bytes <= 0) return;
  await db
    .updateTable("tenants")
    .set((eb) => ({ storage_used_bytes: eb("storage_used_bytes", "-", bytes) }))
    .where("id", "=", currentTenantId())
    .execute();
}

async function insertTenant(name: string, quotaBytes: number | null): Promise<Tenant> {
  if (!name.trim()) throw new AppError(400, "Name required");
  const tenant: Tenant = {
    id: Bun.randomUUIDv7(),
    name: name.trim(),
    quota_bytes: quotaBytes,
    storage_used_bytes: 0,
    suspended_at: null,
    created_at: Date.now(),
  };
  await db.insertInto("tenants").values(tenant).execute();
  return tenant;
}

/** First-run setup: the superadmin's own tenant. */
export function createFirstTenant(name: string): Promise<Tenant> {
  return insertTenant(name, null);
}

// --- Superadmin ---------------------------------------------------------------

export type TenantOverview = Tenant & {
  own: boolean;
  user_count: number;
  album_count: number;
  /** An unused, unexpired admin invite exists. */
  invite_pending: boolean;
};

export async function listTenants(ownTenantId: string): Promise<TenantOverview[]> {
  const rows = await db
    .selectFrom("tenants as t")
    .selectAll("t")
    .select((eb) => [
      eb
        .selectFrom("user")
        .select((e) => e.fn.countAll<number>().as("n"))
        .whereRef("user.tenantId", "=", "t.id")
        .as("user_count"),
      eb
        .selectFrom("albums")
        .select((e) => e.fn.countAll<number>().as("n"))
        .whereRef("albums.tenant_id", "=", "t.id")
        .as("album_count"),
      eb
        .exists(
          eb
            .selectFrom("tenant_invites as i")
            .select("i.id")
            .whereRef("i.tenant_id", "=", "t.id")
            .where("i.role", "=", "admin")
            .where("i.used_at", "is", null)
            .where("i.expires_at", ">", Date.now()),
        )
        .as("invite_pending"),
    ])
    .orderBy("t.created_at")
    .execute();
  return rows.map((r) => ({
    ...r,
    own: r.id === ownTenantId,
    user_count: Number(r.user_count ?? 0),
    album_count: Number(r.album_count ?? 0),
    invite_pending: !!r.invite_pending,
  }));
}

/** New Sammelband plus the invite link for its first admin. */
export async function createTenant(input: {
  name: string;
  quotaBytes: number | null;
}): Promise<{ tenant: Tenant; invite: CreatedInvite }> {
  const tenant = await insertTenant(input.name, input.quotaBytes);
  const invite = await createInvite(tenant.id, "admin");
  return { tenant, invite };
}

/** A fresh admin invite; older unused ones stop working. */
export async function renewAdminInvite(id: string): Promise<CreatedInvite> {
  await requireTenant(id);
  return createInvite(id, "admin", { replaceUnused: true });
}

export async function updateTenant(
  ownTenantId: string,
  id: string,
  patch: { name?: string; quotaBytes?: number | null; suspended?: boolean },
): Promise<Tenant> {
  const tenant = await requireTenant(id);
  if (patch.suspended && id === ownTenantId) {
    throw new AppError(400, "You cannot suspend your own Sammelband");
  }
  if (patch.name !== undefined && !patch.name.trim()) throw new AppError(400, "Name required");
  const suspendedAt =
    patch.suspended === undefined
      ? tenant.suspended_at
      : patch.suspended
        ? (tenant.suspended_at ?? Date.now())
        : null;
  await db
    .updateTable("tenants")
    .set({
      name: patch.name?.trim() ?? tenant.name,
      quota_bytes: patch.quotaBytes === undefined ? tenant.quota_bytes : patch.quotaBytes,
      suspended_at: suspendedAt,
    })
    .where("id", "=", id)
    .execute();
  if (suspendedAt && !tenant.suspended_at) {
    // Sign everyone out right away; the session hook blocks new sign-ins.
    await db
      .deleteFrom("session")
      .where("userId", "in", (eb) => eb.selectFrom("user").select("id").where("tenantId", "=", id))
      .execute();
  }
  return must(await getTenant(id), "Sammelband");
}

/**
 * Delete a Sammelband with all its users, content and files. `confirmName`
 * must repeat its name. The superadmin's own Sammelband can't be deleted.
 */
export async function deleteTenant(
  ownTenantId: string,
  id: string,
  confirmName: string,
): Promise<void> {
  const tenant = await requireTenant(id);
  if (id === ownTenantId) throw new AppError(400, "You cannot delete your own Sammelband");
  if (confirmName.trim() !== tenant.name) {
    throw new AppError(400, "Type the Sammelband's name to confirm");
  }
  await db.transaction().execute(async (trx) => {
    const users = (eb: typeof trx) => eb.selectFrom("user").select("id").where("tenantId", "=", id);
    await trx.deleteFrom("photos").where("tenant_id", "=", id).execute();
    await trx.deleteFrom("image_files").where("tenant_id", "=", id).execute();
    await trx.deleteFrom("album_blocks").where("tenant_id", "=", id).execute();
    await trx.deleteFrom("albums").where("tenant_id", "=", id).execute();
    // folders.parent_id is ON DELETE RESTRICT.
    await trx.updateTable("folders").set({ parent_id: null }).where("tenant_id", "=", id).execute();
    await trx.deleteFrom("folders").where("tenant_id", "=", id).execute();
    await trx.deleteFrom("tenant_invites").where("tenant_id", "=", id).execute();
    await trx.deleteFrom("session").where("userId", "in", users(trx)).execute();
    await trx.deleteFrom("account").where("userId", "in", users(trx)).execute();
    await trx.deleteFrom("user").where("tenantId", "=", id).execute();
    await trx.deleteFrom("tenants").where("id", "=", id).execute();
  });
  rmSync(tenantDir(id), { recursive: true, force: true });
}

/** Instance-wide numbers for the superadmin. */
export async function instanceStats(): Promise<{
  database: { type: typeof dbType; size_bytes: number };
}> {
  return { database: { type: dbType, size_bytes: await databaseSize() } };
}

async function databaseSize(): Promise<number> {
  if (dbType === "postgres") {
    const { rows } = await sql<{
      size: number;
    }>`SELECT pg_database_size(current_database()) AS size`.execute(db);
    return Number(rows[0]?.size ?? 0);
  }
  // WAL mode: recent writes live in the -wal file until a checkpoint.
  let size = 0;
  for (const file of [config.DATABASE_PATH, `${config.DATABASE_PATH}-wal`]) {
    try {
      size += statSync(file).size;
    } catch {
      /* missing -wal is normal */
    }
  }
  return size;
}
