import { createMiddleware } from "hono/factory";

export interface Domains {
  /** The main address: everything is served there. */
  baseUrl: string;
  /** Optional short address for share links: `<shareUrl>/<token>`. */
  shareUrl?: string;
  /** Other addresses the app answers on, e.g. the one before a move. */
  aliasUrls: readonly string[];
}

/** A share token, the only path segment of a short link. */
const SHORT_LINK = /^\/([A-Za-z0-9_-]+)\/?$/;

const hostOf = (url: string) => new URL(url).host.toLowerCase();

export interface Redirect {
  location: string;
  /**
   * 308 for aliases: retired addresses, permanent, keeping the method. 302 for
   * the share domain: it stays the address handed out, so where it leads may change.
   */
  status: 302 | 308;
}

/**
 * Where a request on another domain belongs, or null to serve it here. On an
 * alias every path moves to the same path on the main address, so old links
 * (share links, QR codes in printed PDFs) keep working. The share domain sends
 * `/<token>` to the share page and everything else to the main address too.
 */
export function domainRedirect(domains: Domains, url: URL, host: string): Redirect | null {
  const h = host.toLowerCase();
  if (h === hostOf(domains.baseUrl)) return null;
  const isShare = domains.shareUrl !== undefined && h === hostOf(domains.shareUrl);
  if (!isShare && !domains.aliasUrls.some((a) => hostOf(a) === h)) return null;
  const token = isShare ? SHORT_LINK.exec(url.pathname)?.[1] : undefined;
  // Appended to the origin, never resolved against it: a path like //evil.com
  // would otherwise leave for another host.
  const path = token ? `/s/${token}` : url.pathname;
  return {
    location: new URL(domains.baseUrl).origin + path + url.search,
    status: isShare ? 302 : 308,
  };
}

/**
 * Redirects requests on the share domain and on aliases to the main address.
 * Requests for unknown hosts (direct IP, health checks) are served as before.
 */
export const domainRedirects = (domains: Domains) =>
  createMiddleware(async (c, next) => {
    const host = c.req.header("host");
    const target = host ? domainRedirect(domains, new URL(c.req.url), host) : null;
    return target ? c.redirect(target.location, target.status) : next();
  });
