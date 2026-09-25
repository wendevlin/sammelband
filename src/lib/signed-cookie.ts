import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config";

/**
 * HMAC-signed cookie values: "<value>.<hmac-base64url>".
 *
 * Cheap, dependency-free, and good enough for short-lived share sessions.
 * Not a JWT — no claims, no expiry inside the token (expiry handled by the
 * cookie's Max-Age and by checking `share_links.expires_at` on use).
 */

function hmac(value: string): string {
  return createHmac("sha256", config.SECRET_KEY).update(value).digest("base64url");
}

export function sign(value: string): string {
  return `${value}.${hmac(value)}`;
}

export function verify(signed: string | undefined | null): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = hmac(value);
  // Constant-time compare. Both buffers must be the same length to compare.
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return value;
}
