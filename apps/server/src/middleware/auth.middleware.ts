import type { Context, Next } from "hono";
import { createMiddleware } from "hono/factory";
import { auth } from "../auth";
import { db } from "../db/client";
import { errorBody } from "../lib/error-codes";
import { runInTenant } from "../lib/tenant-context";
import * as twoFactorService from "../services/two-factor.service";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  /** Role within the user's tenant. */
  role: "admin" | "user";
  tenantId: string;
  superadmin: boolean;
  emailVerified: boolean;
  /** Signs in with a code from an authenticator app. */
  twoFactorEnabled: boolean;
};

/** Hono env for routers behind requireAuth: `c.get("user")` is always set. */
export type AuthEnv = { Variables: { user: AuthUser } };

type SessionUser = Omit<AuthUser, "role" | "tenantId" | "superadmin" | "twoFactorEnabled"> & {
  role?: string;
  tenantId?: string | null;
  superadmin?: boolean | null;
  twoFactorEnabled?: boolean | null;
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
    twoFactorEnabled: u.twoFactorEnabled === true,
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
 * request confined to the user's tenant (see lib/tenant-context.ts). Where
 * two-factor authentication is required, users without it only get through
 * guards that allow the setup (`duringSetup`).
 */
function guard(allowed: (user: AuthUser) => boolean, { duringSetup = false } = {}) {
  return createMiddleware<AuthEnv>(async (c: Context<AuthEnv>, next: Next) => {
    const user = await resolveUser(c.req.raw.headers);
    if (!user) return c.json(errorBody("unauthorized"), 401);
    if (await isSuspended(user.tenantId)) {
      return c.json(errorBody("tenant_suspended"), 403);
    }
    if (
      !duringSetup &&
      !user.twoFactorEnabled &&
      (await twoFactorService.isRequired(user.tenantId))
    ) {
      return c.json(errorBody("two_factor_setup_required"), 403);
    }
    if (!allowed(user)) return c.json(errorBody("forbidden"), 403);
    c.set("user", user);
    await runInTenant(user.tenantId, next);
  });
}

/** Any signed-in user. Every user may read and edit everything in their tenant. */
export const requireAuth = guard(() => true);

/** Any signed-in user, also before setting up a required two-factor authentication. */
export const requireSession = guard(() => true, { duringSetup: true });

/** Admin of the user's tenant (users, invites, storage). */
export const requireAdmin = guard((u) => u.role === "admin");

/** The instance owner (tenant management). Sees tenant metadata, not content. */
export const requireSuperadmin = guard((u) => u.superadmin);
