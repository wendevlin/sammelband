import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { auth } from "../auth";
import { db } from "../db/client";
import { runInTenant } from "../lib/tenant-context";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  /** Role within the user's tenant. */
  role: "admin" | "user";
  tenantId: string;
  superadmin: boolean;
  emailVerified: boolean;
};

/** Hono env for routers behind requireAuth: `c.get("user")` is always set. */
export type AuthEnv = { Variables: { user: AuthUser } };

type SessionUser = Omit<AuthUser, "role" | "tenantId" | "superadmin"> & {
  role?: string;
  tenantId?: string | null;
  superadmin?: boolean | null;
};

/** The signed-in user, or null. Users without a tenant (none should exist) count as signed out. */
export async function resolveUser(headers: Headers): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const u = session.user as SessionUser;
  if (!u.tenantId) return null;
  return {
    ...u,
    role: u.role === "admin" ? "admin" : "user",
    tenantId: u.tenantId,
    superadmin: u.superadmin === true,
  };
}

async function isSuspended(tenantId: string): Promise<boolean> {
  const tenant = await db
    .selectFrom("tenants")
    .select("suspended_at")
    .where("id", "=", tenantId)
    .executeTakeFirst();
  return !tenant || tenant.suspended_at !== null;
}

/**
 * Sign-in check shared by the guards: sets `user` and runs the rest of the
 * request confined to the user's tenant (see lib/tenant-context.ts).
 */
function guard(allowed: (user: AuthUser) => boolean) {
  return createMiddleware<AuthEnv>(async (c: Context<AuthEnv>, next: Next) => {
    const user = await resolveUser(c.req.raw.headers);
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    if (await isSuspended(user.tenantId)) {
      return c.json({ error: "This Sammelband is suspended" }, 403);
    }
    if (!allowed(user)) return c.json({ error: "Forbidden" }, 403);
    c.set("user", user);
    await runInTenant(user.tenantId, next);
  });
}

/** Any signed-in user. Every user may read and edit everything in their tenant. */
export const requireAuth = guard(() => true);

/** Admin of the user's tenant (users, invites, storage). */
export const requireAdmin = guard((u) => u.role === "admin");

/** The instance owner (tenant management). Sees tenant metadata, not content. */
export const requireSuperadmin = guard((u) => u.superadmin);
