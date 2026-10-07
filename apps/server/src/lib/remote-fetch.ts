import dns from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../config";
import { fail } from "./errors";

// Requests to servers that admins configure (photo sources). The server makes
// them on behalf of users, so it checks where they go: http(s) only, never
// link-local or metadata addresses, private networks only when allowed
// (SOURCES_ALLOW_PRIVATE_HOSTS), connected to the address it checked,
// redirects re-checked, bounded time and size.

const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

type AddressKind = "blocked" | "private" | "public";

/** Dotted-quad IPv4 as four bytes; no octal, hex or shortened forms. */
function parseIPv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p))) return null;
  const bytes = parts.map(Number);
  return bytes.every((b) => b <= 255) ? bytes : null;
}

/**
 * Any IPv6 spelling as its eight 16-bit groups: "::" compression, an IPv4
 * address in the last 32 bits, any case, leading zeros, a zone id ("%eth0").
 */
function parseIPv6(address: string): number[] | null {
  const halves = (address.split("%")[0] ?? "").split("::");
  if (halves.length > 2) return null;
  const groups = (text: string, last: boolean): number[] | null => {
    if (text === "") return [];
    const parts = text.split(":");
    const out: number[] = [];
    for (const [i, part] of parts.entries()) {
      const v4 = last && i === parts.length - 1 ? parseIPv4(part) : null;
      if (v4) out.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
      else if (/^[0-9a-f]{1,4}$/i.test(part)) out.push(Number.parseInt(part, 16));
      else return null;
    }
    return out;
  };
  const head = groups(halves[0] ?? "", halves.length === 1);
  const tail = halves.length === 2 ? groups(halves[1] ?? "", true) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const zeros = 8 - head.length - tail.length;
  return zeros >= 1 ? [...head, ...new Array<number>(zeros).fill(0), ...tail] : null;
}

// Cloud metadata services outside link-local: Alibaba Cloud, Azure's WireServer.
const METADATA_V4 = new Set(["100.100.100.200", "168.63.129.16"]);
// The IPv6 addresses of AWS's, Google Cloud's and Oracle Cloud's metadata services.
const METADATA_V6 = new Set(
  ["fd00:ec2::254", "fd20:ce::254", "fd00:c1::a9fe:a9fe"].map((a) => parseIPv6(a)?.join(":")),
);

function classifyIPv4(bytes: number[]): AddressKind {
  const [a = 0, b = 0, c = 0] = bytes;
  // "This network" (0.0.0.0 reaches the host itself), multicast, reserved,
  // broadcast; link-local with the cloud metadata address 169.254.169.254;
  // IETF protocol assignments (DS-Lite, NAT64 discovery), which aren't servers.
  if (a === 0 || a >= 224 || (a === 169 && b === 254) || (a === 192 && b === 0 && c === 0))
    return "blocked";
  if (METADATA_V4.has(bytes.join("."))) return "blocked";
  if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))
    return "private";
  if (a === 100 && b >= 64 && b <= 127) return "private"; // CGNAT, e.g. Tailscale
  // Benchmarking, not routed on the internet; used for lab networks and by
  // proxies that answer DNS with fake addresses.
  if (a === 198 && (b === 18 || b === 19)) return "private";
  return "public";
}

function classifyIPv6(h: number[]): AddressKind {
  const embedded = (hi = 0, lo = 0) => classifyIPv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  const zero = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  const [h0 = 0, h1 = 0, h2 = 0] = h;
  // ::ffff:0:0/96, IPv4-mapped: a socket connect reaches the IPv4 address.
  if (zero(0, 5) && h[5] === 0xffff) return embedded(h[6], h[7]);
  if (zero(0, 6)) {
    if (zero(6, 8)) return "blocked"; // ::, unspecified
    if (h[6] === 0 && h[7] === 1) return "private"; // ::1, loopback
    return embedded(h[6], h[7]); // ::/96, IPv4-compatible (deprecated)
  }
  // 64:ff9b::/96, the NAT64 well-known prefix: a translator forwards to the
  // IPv4 address in the last 32 bits.
  if (h0 === 0x64 && h1 === 0xff9b && zero(2, 6)) return embedded(h[6], h[7]);
  // 64:ff9b:1::/48, local-use NAT64: where the IPv4 address sits depends on the
  // operator's prefix length, so there is nothing to check. Blocked.
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 1) return "blocked";
  // 2002::/16, 6to4: tunneled to the IPv4 address in bits 16-47.
  if (h0 === 0x2002) return embedded(h1, h2);
  // 2001::/32, Teredo: relayed to a client behind NAT. Retired (no public
  // Teredo servers, off in Windows), so no photo server lives there. Blocked.
  if (h0 === 0x2001 && h1 === 0) return "blocked";
  if ((h0 & 0xffc0) === 0xfe80) return "blocked"; // fe80::/10, link-local
  if ((h0 & 0xff00) === 0xff00) return "blocked"; // ff00::/8, multicast
  // fc00::/7, unique local
  if ((h0 & 0xfe00) === 0xfc00) return METADATA_V6.has(h.join(":")) ? "blocked" : "private";
  // 2000::/3 is all that is handed out for global unicast; the rest is
  // reserved (::/8 beyond the cases above, 100::/64 discard, deprecated
  // site-local fec0::/10, …).
  return (h0 & 0xe000) === 0x2000 ? "public" : "blocked";
}

/**
 * "blocked" (never), "private" (only when allowed) or "public". IPv6 addresses
 * that carry an IPv4 address (mapped, compatible, NAT64, 6to4) are judged by
 * it. Anything that isn't an IP address is "blocked".
 */
export function classifyAddress(address: string): AddressKind {
  const v4 = parseIPv4(address);
  if (v4) return classifyIPv4(v4);
  const v6 = parseIPv6(address);
  return v6 ? classifyIPv6(v6) : "blocked";
}

/** The URL's addresses, all of them allowed; looked up once, here. */
async function checkHost(url: URL): Promise<string[]> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw fail("source_invalid_url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [host]
    : await dns.lookup(host, { all: true }).then(
        (r) => r.map((x) => x.address),
        () => {
          throw fail("source_unreachable");
        },
      );
  if (addresses.length === 0) throw fail("source_unreachable");
  for (const address of addresses) {
    const kind = classifyAddress(address);
    if (kind === "blocked" || (kind === "private" && !config.SOURCES_ALLOW_PRIVATE_HOSTS)) {
      throw fail("source_host_not_allowed");
    }
  }
  return addresses;
}

/**
 * Where to connect for `url`, given its checked addresses. fetch() would look
 * the name up again, and a name that answers with a public address for the
 * check and a private one for fetch (DNS rebinding) would get through. So
 * http:// connects to the checked address itself and sends the name as Host.
 * https:// connects by name: certificate verification binds the connection to
 * the name, and a server at a rebound address has no certificate for it, so
 * the handshake fails before any request is sent (unless certificate checks
 * are switched off with NODE_TLS_REJECT_UNAUTHORIZED=0).
 */
function connectTargets(url: URL, addresses: string[], init: RequestInit) {
  if (url.protocol !== "http:" || isIP(url.hostname.replace(/^\[|\]$/g, ""))) {
    return [{ url, init }];
  }
  const headers = new Headers(init.headers);
  headers.set("Host", url.host);
  return addresses.map((address) => {
    const pinned = new URL(url);
    pinned.hostname = isIP(address) === 6 ? `[${address}]` : address;
    return { url: pinned, init: { ...init, headers } };
  });
}

// fetch() errors that mean no connection was made, so nothing was sent and
// the next address (in the resolver's order) can be tried, even for a POST.
// Anything else, a timeout too, ends the request.
const NOT_CONNECTED = new Set([
  "ConnectionRefused",
  "FailedToOpenSocket",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

/** fetch() for configured remote servers; network errors become source_unreachable. */
export async function remoteFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const addresses = await checkHost(url);
    const signal = init.signal ?? AbortSignal.timeout(TIMEOUT_MS);
    let res: Response | undefined;
    for (const target of connectTargets(url, addresses, init)) {
      try {
        res = await fetch(target.url, { ...target.init, redirect: "manual", signal });
        break;
      } catch (e) {
        const code = (e as { code?: unknown } | null)?.code;
        if (signal.aborted || typeof code !== "string" || !NOT_CONNECTED.has(code)) break;
      }
    }
    if (!res) throw fail("source_unreachable");
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    // Relative to the URL as named, not the address it was sent to.
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
