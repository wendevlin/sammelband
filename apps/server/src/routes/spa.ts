import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { config } from "../config";
import { type LinkPreview, linkPreview } from "../services/public.service";

/**
 * Serves the built SvelteKit SPA from FRONTEND_DIST. Existing files are served
 * as-is (hashed assets under /_app/immutable are cached forever); every other
 * GET falls back to index.html so client-side routes survive a full page load.
 * Mount this last: /api and /ws must be claimed before it.
 */
export const spaRoutes = new Hono()
  .use(
    "*",
    serveStatic({
      root: config.FRONTEND_DIST,
      onFound: (path, c) => {
        c.header(
          "Cache-Control",
          path.includes("/_app/immutable/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    }),
  )
  .get("*", async (c) => {
    const index = Bun.file(join(config.FRONTEND_DIST, "index.html"));
    if (!(await index.exists())) {
      return c.text(
        "Frontend not built. Run `bun run build`, or use the Vite dev server on :5173.",
        404,
      );
    }
    c.header("Cache-Control", "no-cache");
    let html = await index.text();
    const share = SHARE_PATH.exec(c.req.path);
    if (share?.[1]) {
      // Messenger bots read these for link previews (noindex is set globally).
      const preview = await linkPreview(share[1], {
        albumRef: share[2] === "albums" ? share[3] : undefined,
        folderId: share[2] === "folders" ? share[3] : undefined,
      });
      if (preview) html = html.replace("</head>", `${previewTags(preview, c.req.url)}</head>`);
    }
    return c.html(html);
  });

/** /s/<token>, /s/<token>/albums/<ref>, /s/<token>/folders/<id> */
const SHARE_PATH = /^\/s\/([A-Za-z0-9_-]+)(?:\/(albums|folders)\/([A-Za-z0-9_-]+))?\/?$/;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** Open Graph / Twitter tags that messengers read for link previews. */
function previewTags(p: LinkPreview, pageUrl: string): string {
  const url = new URL(new URL(pageUrl).pathname, config.BASE_URL).href;
  const tags: [string, string, string][] = [
    ["property", "og:site_name", "Sammelband"],
    ["property", "og:type", "website"],
    ["property", "og:url", url],
    ["property", "og:title", p.title],
    ["property", "og:description", p.description],
    ["name", "description", p.description],
    ["name", "twitter:card", p.image ? "summary_large_image" : "summary"],
  ];
  if (p.image) {
    tags.push(
      ["property", "og:image", p.image.url],
      ["property", "og:image:type", "image/jpeg"],
      ["property", "og:image:width", String(p.image.width)],
      ["property", "og:image:height", String(p.image.height)],
    );
  }
  // No <title>: the SPA sets it at runtime, and a static one would stick.
  return tags
    .map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`)
    .join("\n");
}
