import { Elysia, status } from "elysia";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientKey(request: Request): string {
  // Honor reverse-proxy headers if present; fall back to remote address.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function rateLimit(opts: { name: string; windowMs: number; max: number }) {
  return new Elysia({ name: `rl/${opts.name}` }).onBeforeHandle(({ request }) => {
    const key = `${opts.name}:${clientKey(request)}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      return;
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      return status(429, {
        error: "Too many requests",
        retryAfter,
      });
    }
  });
}

// 30 auth attempts per IP per 10 minutes — enough for legitimate retries, blocks brute force.
export const authRateLimit = rateLimit({
  name: "auth",
  windowMs: 10 * 60 * 1000,
  max: 30,
});

// 60 uploads per IP per hour.
export const uploadRateLimit = rateLimit({
  name: "upload",
  windowMs: 60 * 60 * 1000,
  max: 60,
});
