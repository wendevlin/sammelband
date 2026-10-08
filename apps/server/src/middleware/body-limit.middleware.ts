import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { config } from "../config";
import { errorBody } from "../lib/error-codes";

const MB = 1024 * 1024;

/** JSON and forms. The largest real one, a section's text (64k characters), stays well below. */
export const DEFAULT_BODY_LIMIT = 1 * MB;
/** Avatars: profile.service takes up to 5 MB, plus room for the multipart framing. */
export const AVATAR_BODY_LIMIT = 6 * MB;
/**
 * Photo uploads. The editor sends all selected photos in one request, so this
 * stays at the former global cap, and always fits one photo of MAX_UPLOAD_MB.
 */
export const PHOTO_UPLOAD_BODY_LIMIT = Math.max(512 * MB, config.MAX_UPLOAD_BYTES + MB);
/** The largest of them, Bun's hard cap for every request. */
export const MAX_BODY_LIMIT = Math.max(
  DEFAULT_BODY_LIMIT,
  AVATAR_BODY_LIMIT,
  PHOTO_UPLOAD_BODY_LIMIT,
);

/** The multipart upload routes, the only ones with more than the default. */
const UPLOAD_ROUTES: [method: string, path: RegExp, limit: number][] = [
  ["POST", /^\/api\/sections\/[^/]+\/photos$/, PHOTO_UPLOAD_BODY_LIMIT],
  ["POST", /^\/api\/profile\/avatar$/, AVATAR_BODY_LIMIT],
  ["POST", /^\/api\/admin\/users\/[^/]+\/avatar$/, AVATAR_BODY_LIMIT],
];

/** The largest request body a route accepts, by method and path. */
export function bodyLimitFor(method: string, path: string): number {
  const route = UPLOAD_ROUTES.find(([m, p]) => m === method && p.test(path));
  return route?.[2] ?? DEFAULT_BODY_LIMIT;
}

/** hono/body-limit trusts a Content-Length (unless the body is chunked). */
function hasDeclaredLength(headers: Headers): boolean {
  return headers.has("content-length") && !headers.has("transfer-encoding");
}

/**
 * Body limits for /api, so no request can make the server hold more than its
 * route needs. hono/body-limit rejects a declared Content-Length up front, but
 * reads a body of unknown length into memory while counting, before the
 * route's sign-in check runs. So such uploads (some proxies re-chunk them) get
 * the larger limit only from a signed-in user.
 */
export function apiBodyLimit(isSignedIn: (headers: Headers) => Promise<boolean>) {
  return createMiddleware(async (c, next) => {
    let maxSize = bodyLimitFor(c.req.method, c.req.path);
    if (
      maxSize > DEFAULT_BODY_LIMIT &&
      c.req.raw.body &&
      !hasDeclaredLength(c.req.raw.headers) &&
      !(await isSignedIn(c.req.raw.headers))
    ) {
      maxSize = DEFAULT_BODY_LIMIT;
    }
    const limit = bodyLimit({
      maxSize,
      onError: (c) =>
        c.json(errorBody("payload_too_large", { maxMb: Math.round(maxSize / MB) }), 413),
    });
    return limit(c, next);
  });
}
