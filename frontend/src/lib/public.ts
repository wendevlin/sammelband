import { error } from "@sveltejs/kit";
import { ApiError, api } from "$lib/api";
import type { SharedView } from "$lib/types";

/** Load a public link's view; unknown, expired or revoked links become a 404 page. */
export async function loadShared(
  token: string,
  at: { album?: string; folder?: string },
  f: typeof fetch,
): Promise<SharedView> {
  const params = new URLSearchParams(at as Record<string, string>).toString();
  try {
    return await api<SharedView>(`/public/${token}${params ? `?${params}` : ""}`, { fetch: f });
  } catch (e) {
    if (e instanceof ApiError) error(e.status === 429 ? 429 : 404, e.message);
    throw e;
  }
}

export const sharePath = (token: string, rest = "") => `/s/${token}${rest}`;
