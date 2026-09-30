import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { createMiddleware } from "hono/factory";
import { config } from "../config";
import { errorBody } from "../lib/error-codes";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Drop expired buckets now and then so the map doesn't grow without bound.
const PRUNE_EVERY_MS = 60 * 1000;
let lastPrune = 0;
function prune(now: number): void {
  if (now - lastPrune < PRUNE_EVERY_MS) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) if (bucket.resetAt < now) buckets.delete(key);
}

/**
 * The client's IP. Proxy headers are only honored with TRUST_PROXY=true:
 * otherwise anyone could send a fresh X-Forwarded-For per request and reset
 * every limit.
 */
export function clientIp(c: Context): string {
  if (config.TRUST_PROXY) {
    const forwarded =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip");
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // not running under Bun.serve (tests)
  }
}

export function rateLimit(opts: { name: string; windowMs: number; max: number }) {
  return createMiddleware(async (c, next) => {
    const key = `${opts.name}:${clientIp(c)}`;
    const now = Date.now();
    prune(now);
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > opts.max) {
        const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        return c.json({ ...errorBody("rate_limited", { retryAfter }), retryAfter }, 429);
      }
    }
    await next();
  });
}

// 30 auth attempts per IP per 10 minutes — enough for legitimate retries, blocks brute force.
// Also guards the first-run setup code and invite links.
export const authRateLimit = rateLimit({
  name: "auth",
  windowMs: 10 * 60 * 1000,
  max: 30,
});

// Password reset mails: 5 per IP per hour, so the app can't be used to flood
// someone's inbox.
export const passwordResetRateLimit = rateLimit({
  name: "password-reset",
  windowMs: 60 * 60 * 1000,
  max: 5,
});

// 60 upload requests per IP per hour.
export const uploadRateLimit = rateLimit({
  name: "upload",
  windowMs: 60 * 60 * 1000,
  max: 60,
});
