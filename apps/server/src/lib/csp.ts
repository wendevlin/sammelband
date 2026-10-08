import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const HASH_SOURCE = /^'sha(256|384|512)-[A-Za-z0-9+/_-]+={0,2}'$/;

/**
 * The hash sources ('sha256-…') of script-src in an HTML page's CSP meta tags.
 * SvelteKit's build puts its inline bootstrap script's hash there.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bhttp-equiv\s*=\s*["']?content-security-policy["'\s/>]/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
    for (const directive of content.split(";")) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      if (name?.toLowerCase() !== "script-src") continue;
      for (const source of sources) if (HASH_SOURCE.test(source)) hashes.add(source);
    }
  }
  return [...hashes];
}

/**
 * script-src for the CSP header: the app's own files, and inline only the
 * scripts the built index.html declares by hash (the `csp` option in
 * apps/web/vite.config.ts makes SvelteKit list them).
 */
export function scriptSources(frontendDist: string): string[] {
  const index = join(frontendDist, "index.html");
  const hashes = existsSync(index) ? inlineScriptHashes(readFileSync(index, "utf8")) : [];
  return ["'self'", ...hashes];
}

/**
 * The hash sources of the built index.html, as one string for a CSP directive
 * (hono's secureHeaders calls it per response). Read again whenever the file
 * changes, so rebuilding the frontend doesn't need a server restart.
 */
export function builtScriptHashes(frontendDist: string): () => string {
  const index = join(frontendDist, "index.html");
  let cached: { mtimeMs: number; value: string } | null = null;
  return () => {
    let mtimeMs: number;
    try {
      mtimeMs = statSync(index).mtimeMs;
    } catch {
      cached = null;
      return "";
    }
    if (cached?.mtimeMs !== mtimeMs) {
      cached = { mtimeMs, value: scriptSources(frontendDist).slice(1).join(" ") };
    }
    return cached.value;
  };
}
