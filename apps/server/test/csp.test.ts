import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtScriptHashes, inlineScriptHashes, scriptSources } from "../src/lib/csp";

const HASH = "'sha256-MLvhrzKAmr2dKBTiO5AE4uVhUFxX6a9YO6/HqksaON8='";

/** Shaped like SvelteKit's built index.html. */
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="content-security-policy" content="script-src 'self' ${HASH}">
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body><script>__sveltekit = {}</script></body>
</html>`;

describe("CSP script hashes", () => {
  test("from SvelteKit's meta tag", () => {
    expect(inlineScriptHashes(INDEX_HTML)).toEqual([HASH]);
  });

  test("only hashes, only from script-src of a CSP meta tag", () => {
    const html = `
      <META HTTP-EQUIV="Content-Security-Policy"
        content="default-src 'self'; script-src 'self' 'unsafe-inline' 'nonce-abc' 'sha384-AbC+/1=' https://cdn.example; style-src 'sha256-c3R5bGU='">
      <meta http-equiv="content-security-policy-report-only" content="script-src 'sha256-cmVwb3J0='">
      <meta name="description" content="script-src 'sha256-ZGVzYw=='">
      <meta http-equiv="content-security-policy" content="script-src-elem 'sha256-ZWxlbQ=='">`;
    expect(inlineScriptHashes(html)).toEqual(["'sha384-AbC+/1='"]);
  });

  test("none without a meta tag", () => {
    expect(inlineScriptHashes("<html><head></head><body></body></html>")).toEqual([]);
  });

  test("script-src for the header: the built page's hashes, or only 'self'", () => {
    const dist = mkdtempSync(join(tmpdir(), "sammelband-csp-"));
    try {
      expect(scriptSources(dist)).toEqual(["'self'"]);
      writeFileSync(join(dist, "index.html"), INDEX_HTML);
      expect(scriptSources(dist)).toEqual(["'self'", HASH]);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  test("the header's hashes follow a rebuilt index.html", () => {
    const dist = mkdtempSync(join(tmpdir(), "sammelband-csp-"));
    const index = join(dist, "index.html");
    try {
      const hashes = builtScriptHashes(dist);
      expect(hashes()).toBe("");
      writeFileSync(index, INDEX_HTML);
      expect(hashes()).toBe(HASH);
      const rebuilt = "'sha256-cmVidWlsdA=='";
      writeFileSync(index, INDEX_HTML.replace(HASH, rebuilt));
      utimesSync(index, new Date(), new Date(Date.now() + 5000));
      expect(hashes()).toBe(rebuilt);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
