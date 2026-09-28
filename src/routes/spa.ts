import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { config } from "../config";

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
        "Frontend not built. Run `bun run build:frontend`, or use the Vite dev server on :5173.",
        404,
      );
    }
    c.header("Cache-Control", "no-cache");
    // Public link pages stay out of search engines.
    if (c.req.path.startsWith("/s/")) c.header("X-Robots-Tag", "noindex, nofollow");
    return c.body(await index.arrayBuffer(), 200, { "Content-Type": "text/html; charset=utf-8" });
  });
