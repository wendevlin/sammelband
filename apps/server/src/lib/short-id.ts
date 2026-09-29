const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Random lowercase alphanumeric id for URLs (36^8 ≈ 2.8e12 combinations).
 * No "-" so it can follow a slug: /albums/<slug>-<shortId>.
 */
export function shortId(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  // 252 = 7 * 36: rejecting bytes above it keeps the distribution uniform.
  for (const b of bytes)
    out += b < 252 ? ALPHABET[b % 36] : ALPHABET[Math.floor(Math.random() * 36)];
  return out;
}
