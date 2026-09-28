import { error, redirect } from "@sveltejs/kit";
import { auth } from "$lib/stores/auth.svelte";

/**
 * Thin fetch wrapper. Cookies flow with every request; non-2xx throws ApiError.
 * All HTTP API routes live under /api; callers pass the path without it.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(messageOf(body) ?? `HTTP ${status}`);
  }
}

function messageOf(body: unknown): string | null {
  if (typeof body !== "object" || !body) return null;
  const b = body as { error?: unknown; message?: unknown };
  if (typeof b.error === "string") return b.error;
  if (typeof b.message === "string") return b.message;
  return null;
}

type Options = Omit<RequestInit, "body"> & { body?: unknown; fetch?: typeof fetch };

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { body, headers, fetch: f = fetch, ...rest } = opts;
  const finalHeaders = new Headers(headers);
  let finalBody: BodyInit | undefined;
  if (body instanceof FormData) {
    finalBody = body;
  } else if (body !== undefined) {
    finalHeaders.set("content-type", "application/json");
    finalBody = JSON.stringify(body);
  }

  const res = await f(`/api${path}`, {
    credentials: "include",
    ...rest,
    headers: finalHeaders,
    body: finalBody,
  });

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

export const post = <T = unknown>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body ?? {} });
export const patch = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body });
export const del = <T = unknown>(path: string) => api<T>(path, { method: "DELETE" });

/**
 * Login page URL that returns to `target` after sign-in. Only same-origin
 * paths survive (see `safeNext`), so `next` can't become an open redirect.
 */
export function loginUrl(target: URL | string): string {
  const path = typeof target === "string" ? target : target.pathname + target.search;
  return path === "/" || path.startsWith("/login")
    ? "/login"
    : `/login?next=${encodeURIComponent(path)}`;
}

/** The post-login destination from `?next=`, or "/" if missing or not a local path. */
export function safeNext(url: URL): string {
  const next = url.searchParams.get("next");
  return next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

/** For load functions: map API failures to SvelteKit errors / the login redirect. */
export async function load<T>(path: string, f: typeof fetch): Promise<T> {
  // While first-run setup is pending the root layout shows only the onboarding
  // form; skip page data instead of bouncing to /login on the 401.
  if (auth.needsOnboarding) error(503, "Setup required");
  try {
    return await api<T>(path, { fetch: f });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) redirect(307, loginUrl(location.href.slice(location.origin.length)));
      error(e.status, e.message);
    }
    throw e;
  }
}
