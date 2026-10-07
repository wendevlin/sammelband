import { Hono, type MiddlewareHandler } from "hono";
import { errorBody } from "../lib/error-codes";

/** How an allowed better-auth endpoint is rate limited. */
export type AuthLimit = "none" | "credentials" | "password-reset";

/**
 * The better-auth endpoints the app calls over HTTP, under /api/auth. The rest
 * of what better-auth offers (update-user, change-email, list-sessions, …)
 * answers 404: profile changes have their own routes with their own checks, and
 * server code calls auth.api in-process.
 */
export const AUTH_ENDPOINTS: readonly {
  method: "GET" | "POST";
  path: string;
  limit: AuthLimit;
}[] = [
  // The SPA asks on every page load, so no limit: a household behind one
  // address would lock itself out. Signing out checks nothing either.
  { method: "GET", path: "/get-session", limit: "none" },
  { method: "POST", path: "/sign-out", limit: "none" },
  // Everything that checks a password, a code or a token.
  { method: "POST", path: "/sign-in/email", limit: "credentials" },
  { method: "POST", path: "/two-factor/verify-totp", limit: "credentials" },
  { method: "POST", path: "/two-factor/verify-backup-code", limit: "credentials" },
  { method: "POST", path: "/two-factor/enable", limit: "credentials" },
  { method: "POST", path: "/two-factor/disable", limit: "credentials" },
  { method: "POST", path: "/two-factor/generate-backup-codes", limit: "credentials" },
  // The link in the reset mail (redirects to the SPA's /reset-password), then
  // setting the new password there.
  { method: "GET", path: "/reset-password/:token", limit: "credentials" },
  { method: "POST", path: "/reset-password", limit: "credentials" },
  // "Forgot password?": a stricter limit of its own, and only with SMTP.
  { method: "POST", path: "/request-password-reset", limit: "password-reset" },
];

/**
 * Routes for /api/auth: the endpoints above, each behind its limit, passed on
 * to better-auth's `handler`.
 */
export function authRoutes(opts: {
  handler: (request: Request) => Response | Promise<Response>;
  limits: Record<Exclude<AuthLimit, "none">, MiddlewareHandler[]>;
}) {
  const routes = new Hono();
  // Closed instance: accounts are created by an admin, an invite link or the
  // first-run setup, all server-side, so the public sign-up is blocked.
  routes.post("/sign-up/*", (c) => c.json(errorBody("signup_disabled"), 403));
  for (const { method, path, limit } of AUTH_ENDPOINTS) {
    const middleware = limit === "none" ? [] : opts.limits[limit];
    // (A list of paths: the overload that takes any number of handlers.)
    routes.on(method, [path], ...middleware, (c) => opts.handler(c.req.raw));
  }
  routes.all("*", (c) => c.json(errorBody("not_found"), 404));
  return routes;
}
