import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { auth } from "../auth";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  emailVerified: boolean;
};

/** Hono env for routers behind requireAuth: `c.get("user")` is always set. */
export type AuthEnv = { Variables: { user: AuthUser } };

export async function resolveUser(headers: Headers): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const u = session.user as AuthUser & { role?: string };
  return { ...u, role: u.role === "admin" ? "admin" : "user" };
}

function unauthorized(c: Context) {
  return c.json({ error: "Unauthorized" }, 401);
}

/** Any signed-in user. Every user may read and edit all folders and albums. */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const user = await resolveUser(c.req.raw.headers);
  if (!user) return unauthorized(c);
  c.set("user", user);
  await next();
});

/** Signed-in admin (user management, storage). */
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const user = await resolveUser(c.req.raw.headers);
  if (!user) return unauthorized(c);
  if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);
  c.set("user", user);
  await next();
});
