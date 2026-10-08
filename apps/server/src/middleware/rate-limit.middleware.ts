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
 * The client's address as the trusted proxies report it, or undefined. Each
 * proxy appends the address it saw to X-Forwarded-For, so with `hops` proxies
 * the client is the entry `hops` from the end. Everything left of it came from
 * the client and could be anything. X-Real-IP is only a fallback for proxies
 * that don't set X-Forwarded-For.
 */
export function forwardedClientIp(
  forwardedFor: string | undefined,
  realIp: string | undefined,
  hops: number,
): string | undefined {
  const chain = (forwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length >= hops) return chain[chain.length - hops];
  return realIp?.trim() || undefined;
}

/**
 * The client's IP. Proxy headers are only honored with TRUST_PROXY=true:
 * otherwise anyone could send a fresh X-Forwarded-For per request and reset
 * every limit.
 */
export function clientIp(
  c: Context,
  proxy: { trust: boolean; hops: number } = {
    trust: config.TRUST_PROXY,
    hops: config.TRUST_PROXY_HOPS,
  },
): string {
  if (proxy.trust) {
    const forwarded = forwardedClientIp(
      c.req.header("x-forwarded-for"),
      c.req.header("x-real-ip"),
      proxy.hops,
    );
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown"; // not running under Bun.serve (tests)
  }
}

/**
 * At most `max` requests per `windowMs`, counted per client IP, or per what
 * `key` returns (e.g. a share link's token, to bound guesses from many IPs).
 * With `failuresOnly`, requests answered below 400 don't count: for limits on
 * guesses, where every right answer is someone legitimate.
 */
export function rateLimit(opts: {
  name: string;
  windowMs: number;
  max: number;
  key?: (c: Context) => string;
  failuresOnly?: boolean;
}) {
  const keyOf = opts.key ?? ((c: Context) => clientIp(c));
  return createMiddleware(async (c, next) => {
    const key = `${opts.name}:${keyOf(c)}`;
    const now = Date.now();
    prune(now);
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ ...errorBody("rate_limited", { retryAfter }), retryAfter }, 429);
    }
    // Counted up front, so parallel requests can't all slip through.
    bucket.count += 1;
    await next();
    if (opts.failuresOnly && c.res.status < 400) bucket.count -= 1;
  });
}

// 30 auth attempts per IP per 10 minutes — enough for legitimate retries, blocks brute force.
// Guards everything that checks a password, code or token: the better-auth
// endpoints that do (routes/auth.ts), profile changes that ask for the current
// password, the first-run setup code and invite links.
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
