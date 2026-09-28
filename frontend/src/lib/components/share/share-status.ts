import type { ShareLinkInfo } from "$lib/types";

export const isExpired = (link: ShareLinkInfo) =>
  link.expires_at !== null && link.expires_at < Date.now();

/** "active": at least one working link; "expired": links exist, all expired. */
export function shareStatus(links: ShareLinkInfo[]): "none" | "active" | "expired" {
  if (links.length === 0) return "none";
  return links.some((l) => !isExpired(l)) ? "active" : "expired";
}
