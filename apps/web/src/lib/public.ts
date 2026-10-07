import type { SharedView } from "@sammelband/shared";
import { error } from "@sveltejs/kit";
import { ApiError, api } from "#lib/api.ts";
import { errorText } from "#lib/i18n.ts";

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
    if (e instanceof ApiError) error(e.status === 429 ? 429 : 404, errorText(e));
    throw e;
  }
}

export const sharePath = (token: string, rest = "") => `/s/${token}${rest}`;
