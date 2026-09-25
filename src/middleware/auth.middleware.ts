import { Elysia, status } from "elysia";
import { auth } from "../auth";
import { config } from "../config";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  emailVerified: boolean;
};

async function resolveUser(headers: Headers): Promise<AuthUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session?.user) return null;
  const u = session.user as AuthUser & { role?: string };
  return { ...u, role: (u.role as "admin" | "user") ?? "user" };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const allowedOrigins = new Set([
  new URL(config.BASE_URL).origin,
  // In dev the Vite dev server runs at :5173 and proxies to :3000. Requests
  // arriving via the proxy keep the original Origin header from the browser,
  // so we allow that origin too when not in production.
  ...(config.isDev ? ["http://localhost:5173"] : []),
]);

function checkOriginAllowed(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return true;
  const raw = request.headers.get("origin") ?? request.headers.get("referer");
  if (!raw) return false;
  try {
    return allowedOrigins.has(new URL(raw).origin);
  } catch {
    return false;
  }
}

/**
 * Returns a fresh Elysia instance pre-wired with admin auth + CSRF check.
 * The `.resolve` short-circuits with 401/403 if the request fails the guard,
 * so `user` is always non-null inside handlers.
 */
export function adminRouter(prefix?: string) {
  return new Elysia(prefix ? { prefix } : undefined).resolve(
    async ({ request }): Promise<{ user: AuthUser }> => {
      const user = await resolveUser(request.headers);
      if (!user) throw status(401, { error: "Unauthorized" });
      if (user.role !== "admin") throw status(403, { error: "Forbidden" });
      if (!checkOriginAllowed(request))
        throw status(403, { error: "Origin not allowed" });
      return { user };
    },
  );
}

/** Authenticated-user (no admin check, no CSRF). */
export function userRouter(prefix?: string) {
  return new Elysia(prefix ? { prefix } : undefined).resolve(
    async ({ request }): Promise<{ user: AuthUser }> => {
      const user = await resolveUser(request.headers);
      if (!user) throw status(401, { error: "Unauthorized" });
      return { user };
    },
  );
}
