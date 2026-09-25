import { createMiddleware } from "hono/factory";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function clientKey(request: Request): string {
  // Honor reverse-proxy headers if present.
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function rateLimit(opts: { name: string; windowMs: number; max: number }) {
  return createMiddleware(async (c, next) => {
    const key = `${opts.name}:${clientKey(c.req.raw)}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > opts.max) {
        const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        return c.json({ error: "Too many requests", retryAfter }, 429);
      }
    }
    await next();
  });
}

// 30 auth attempts per IP per 10 minutes — enough for legitimate retries, blocks brute force.
export const authRateLimit = rateLimit({
  name: "auth",
  windowMs: 10 * 60 * 1000,
  max: 30,
});

// 60 upload requests per IP per hour.
export const uploadRateLimit = rateLimit({
  name: "upload",
  windowMs: 60 * 60 * 1000,
  max: 60,
});
