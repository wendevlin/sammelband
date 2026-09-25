/**
 * Thin fetch wrapper. Always includes credentials so cookie-based sessions and
 * the sb_share share session both flow through. Throws an ApiError on non-2xx.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(
      typeof body === "object" && body && "error" in body
        ? String((body as { error: unknown }).error)
        : `HTTP ${status}`,
    );
  }
}

type Options = RequestInit & {
  /** Optional value for the X-Share-Password header on /share/:token. */
  sharePassword?: string;
};

// All HTTP API routes live under /api (so they never collide with SPA routes).
// Callers pass the path without this prefix, e.g. api("/albums/123").
const API_BASE = "/api";

export async function api<T = unknown>(
  path: string,
  opts: Options = {},
): Promise<T> {
  const { sharePassword, headers, body, ...rest } = opts;
  const finalHeaders = new Headers(headers);
  if (
    body &&
    !(body instanceof FormData) &&
    !finalHeaders.has("content-type")
  ) {
    finalHeaders.set("content-type", "application/json");
  }
  if (sharePassword) finalHeaders.set("x-share-password", sharePassword);

  const res = await fetch(API_BASE + path, {
    credentials: "include",
    ...rest,
    headers: finalHeaders,
    body,
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let payload: unknown = text;
  if (text && res.headers.get("content-type")?.includes("application/json")) {
    try {
      payload = JSON.parse(text);
    } catch {
      /* keep text */
    }
  }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

export function apiJSON<T = unknown>(
  path: string,
  body: unknown,
  opts: Options = {},
): Promise<T> {
  return api<T>(path, {
    method: "POST",
    ...opts,
    body: JSON.stringify(body),
  });
}
