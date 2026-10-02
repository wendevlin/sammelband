import Cloud from "@lucide/svelte/icons/cloud";
import type { SourceAccount, SourceId, SourceInfo } from "@sammelband/shared";

// What the web app knows about each photo source besides the API: its icon.
// Browsing and importing work the same for every source (source-picker.svelte);
// connecting an account is per source (profile page). Immich: one more entry.

export const SOURCE_ICONS: Record<SourceId, typeof Cloud> = { nextcloud: Cloud };

export const thumbnailUrl = (account: string, thumb: string, size: 128 | 256 | 512 = 256) =>
  `/api/sources/accounts/${account}/thumbnail?${new URLSearchParams({ id: thumb, size: String(size) })}`;

/**
 * How an account is called in menus: its name, else the source's, with the
 * login when the user has several unnamed accounts there.
 */
export function accountTitle(source: SourceInfo, account: SourceAccount): string {
  if (account.name) return account.name;
  const unnamed = source.accounts.filter((a) => !a.name).length;
  return unnamed > 1 ? `${source.name} (${account.label})` : source.name;
}

/** "cloud.example.com" for "https://cloud.example.com/nextcloud". */
export const serverHost = (server: string) => {
  try {
    const url = new URL(server);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return server;
  }
};
