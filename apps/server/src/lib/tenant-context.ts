import { AsyncLocalStorage } from "node:async_hooks";
import type { Kysely } from "kysely";
import { withTransactionGuard } from "../db/bun-sqlite-dialect";
import { db } from "../db/client";
import type { Database } from "../db/schema";
import { TenantScopePlugin } from "../db/tenant-scope";

/**
 * The tenant of the current request. requireAuth sets it from the signed-in
 * user; services read it through tdb() and never take a tenant id from input.
 */
const storage = new AsyncLocalStorage<{ tenantId: string; db: Kysely<Database> }>();

export function runInTenant<T>(tenantId: string, fn: () => T): T {
  const ctx = { tenantId, db: db.withPlugin(new TenantScopePlugin(tenantId)) };
  return storage.run(ctx, () => withTransactionGuard(fn));
}

export function currentTenantId(): string {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("No tenant in context: wrap the call in runInTenant()");
  return ctx.tenantId;
}

/** The database, confined to the current tenant (see TenantScopePlugin). */
export function tdb(): Kysely<Database> {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("No tenant in context: wrap the call in runInTenant()");
  return ctx.db;
}
