import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../config";
import { fail } from "./errors";

// Requests to servers that admins configure (photo sources). The server makes
// them on behalf of users, so it checks where they go: http(s) only, never
// link-local or metadata addresses, private networks only when allowed
// (SOURCES_ALLOW_PRIVATE_HOSTS), redirects re-checked, bounded time and size.

const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

function ipv4(address: string): number[] | null {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)
    ? parts
    : null;
}

/** "blocked" (never), "private" (only when allowed) or "public". */
export function classifyAddress(address: string): "blocked" | "private" | "public" {
  const a = address.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const v4 = ipv4(mapped ?? a);
  if (v4) {
    const [x = 0, y = 0] = v4;
    if (x === 0 || x >= 224 || (x === 169 && y === 254)) return "blocked";
    if (x === 10 || x === 127 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168))
      return "private";
    if (x === 100 && y >= 64 && y <= 127) return "private"; // CGNAT, e.g. Tailscale
    return "public";
  }
  if (
    a === "::" ||
    a.startsWith("fe8") ||
    a.startsWith("fe9") ||
    a.startsWith("fea") ||
    a.startsWith("feb") ||
    a.startsWith("ff")
  )
    return "blocked";
  if (a === "::1" || a.startsWith("fc") || a.startsWith("fd")) return "private";
  return "public";
}

async function checkHost(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw fail("source_invalid_url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true }).then(
        (r) => r.map((x) => x.address),
        () => {
          throw fail("source_unreachable");
        },
      );
  for (const address of addresses) {
    const kind = classifyAddress(address);
    if (kind === "blocked" || (kind === "private" && !config.SOURCES_ALLOW_PRIVATE_HOSTS)) {
      throw fail("source_host_not_allowed");
    }
  }
}

/** fetch() for configured remote servers; network errors become source_unreachable. */
export async function remoteFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkHost(url);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw fail("source_unreachable");
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    url = new URL(location, url);
  }
  throw fail("source_unreachable");
}

/** The body, or source_too_large past `max` bytes (without reading it all). */
export async function readLimited(res: Response, max: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > max) throw fail("file_too_large", { maxMb: Math.round(max / 1024 / 1024) });
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw fail("file_too_large", { maxMb: Math.round(max / 1024 / 1024) });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
