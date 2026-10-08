import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import dns from "node:dns/promises";
import { config } from "../src/config";
import { classifyAddress, remoteFetch } from "../src/lib/remote-fetch";

// A server on 127.0.0.1 only that records what arrives: path and Host header.
type Seen = { path: string; host: string | null };
let seen: Seen[] = [];
let server: ReturnType<typeof Bun.serve>;
let port = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      const url = new URL(req.url);
      seen.push({ path: url.pathname, host: req.headers.get("host") });
      if (url.pathname === "/dir/relative") {
        return new Response(null, { status: 302, headers: { Location: "next?x=1" } });
      }
      if (url.pathname === "/to-metadata") {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://[::ffff:a9fe:a9fe]/latest/meta-data/" },
        });
      }
      if (url.pathname === "/to-nat64") {
        return new Response(null, {
          status: 307,
          headers: { Location: "http://[64:ff9b::a9fe:a9fe]/" },
        });
      }
      return new Response(`${req.method} ${url.pathname}`);
    },
  });
  port = server.port ?? 0;
});
afterAll(() => server.stop(true));

const spies: { mockRestore(): void }[] = [];
afterEach(() => {
  for (const spy of spies.splice(0).reverse()) spy.mockRestore();
  seen = [];
});

/** Names resolve to these addresses, whatever DNS says. */
function resolveTo(...addresses: string[]) {
  const lookup = spyOn(dns, "lookup").mockImplementation((async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))) as never);
  spies.push(lookup);
  return lookup;
}

/** Records the URLs fetch() is asked for, and still makes the requests. */
function watchFetch() {
  const spy = spyOn(globalThis, "fetch");
  spies.push(spy);
  return () => spy.mock.calls.map(([input]) => String(input));
}

describe("address classification", () => {
  test.each([
    // IPv4-mapped IPv6, in hex as URLs write it, and spelled out.
    ["::ffff:7f00:1", "private"],
    ["0:0:0:0:0:ffff:7f00:1", "private"],
    ["0000:0000:0000:0000:0000:FFFF:7F00:0001", "private"],
    ["::ffff:127.0.0.1", "private"],
    ["::ffff:a9fe:a9fe", "blocked"],
    ["::ffff:169.254.1.1", "blocked"],
    ["::ffff:1.1.1.1", "public"],
    // IPv4-compatible (deprecated).
    ["::7f00:1", "private"],
    ["::127.0.0.1", "private"],
    ["::a9fe:a9fe", "blocked"],
    ["::0.0.0.2", "blocked"],
    // NAT64: the well-known prefix carries the IPv4 address, local use is blocked.
    ["64:ff9b::7f00:1", "private"],
    ["64:ff9b::127.0.0.1", "private"],
    ["64:ff9b::a9fe:a9fe", "blocked"],
    ["64:ff9b::101:101", "public"],
    ["64:ff9b:1::101:101", "blocked"],
    // 6to4 carries the IPv4 address in bits 16-47; Teredo is blocked.
    ["2002:7f00:1::1", "private"],
    ["2002:a9fe:a9fe::1", "blocked"],
    ["2002:101:101::1", "public"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "blocked"],
    // Unspecified, loopback, link-local (with zone id), multicast, unique local.
    ["::", "blocked"],
    ["::1", "private"],
    ["0:0:0:0:0:0:0:1", "private"],
    ["fe80::1", "blocked"],
    ["FE80::1%eth0", "blocked"],
    ["febf::1", "blocked"],
    ["ff02::1", "blocked"],
    ["fc00::1", "private"],
    ["fd00::1", "private"],
    // Reserved, outside 2000::/3.
    ["100::1", "blocked"],
    ["fec0::1", "blocked"],
    ["4000::1", "blocked"],
    // Cloud metadata services.
    ["169.254.169.254", "blocked"],
    ["fd00:ec2::254", "blocked"],
    ["fd20:ce::254", "blocked"],
    ["fd00:c1::a9fe:a9fe", "blocked"],
    ["100.100.100.200", "blocked"],
    ["168.63.129.16", "blocked"],
    // IPv4.
    ["0.0.0.0", "blocked"],
    ["224.0.0.1", "blocked"],
    ["240.0.0.1", "blocked"],
    ["255.255.255.255", "blocked"],
    ["192.0.0.8", "blocked"],
    ["127.0.0.1", "private"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.10", "private"],
    ["100.64.0.1", "private"],
    ["100.100.1.1", "private"],
    ["198.18.0.1", "private"],
    ["198.19.255.254", "private"],
    // Public addresses, also in unusual spellings.
    ["1.1.1.1", "public"],
    ["93.184.216.34", "public"],
    ["172.32.0.1", "public"],
    ["100.128.0.1", "public"],
    ["198.20.0.1", "public"],
    ["192.0.2.1", "public"],
    ["2606:4700::1111", "public"],
    ["2606:4700:4700:0:0:0:0:1111", "public"],
    ["2A01:04F8::0001", "public"],
    ["2001:4860:4860::8888", "public"],
    ["2001:db8:1:2:3:4:1.2.3.4", "public"],
    // Not an address: never "public".
    ["localhost", "blocked"],
    ["", "blocked"],
    ["1.2.3", "blocked"],
    ["01.2.3.4", "blocked"],
    ["0x7f.0.0.1", "blocked"],
    ["1.2.3.256", "blocked"],
    ["1..2.3", "blocked"],
    ["[::1]", "blocked"],
    ["1::2::3", "blocked"],
    [":::", "blocked"],
    ["12345::1", "blocked"],
    ["1:2:3:4:5:6:7:8:9", "blocked"],
    ["2606:4700:1:2::3:4:5:6", "blocked"],
    ["2606:4700::1.2.3.4:5", "blocked"],
    ["1.2.3.4::", "blocked"],
  ])("%p is %s", (address, kind) => {
    expect<string>(classifyAddress(address)).toBe(kind);
  });
});

describe("remote requests", () => {
  test("http:// connects to the address it checked and sends the name as Host", async () => {
    const urls = watchFetch();
    const res = await remoteFetch(`http://localhost:${port}/a`);
    expect(await res.text()).toBe("GET /a");
    expect(seen).toEqual([{ path: "/a", host: `localhost:${port}` }]);
    // After [::1] where localhost has that address too.
    expect(urls().at(-1)).toBe(`http://127.0.0.1:${port}/a`);
    expect(urls().filter((u) => u.includes("localhost"))).toEqual([]);
  });

  test("a name is looked up once, and fetch() never resolves it again", async () => {
    // .example names don't exist: only the checked address can reach the server.
    const lookup = resolveTo("127.0.0.1");
    const res = await remoteFetch(`http://nextcloud.example:${port}/b`, { method: "PROPFIND" });
    expect(await res.text()).toBe("PROPFIND /b");
    expect(seen).toEqual([{ path: "/b", host: `nextcloud.example:${port}` }]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  test("one address not allowed refuses the name before connecting", async () => {
    resolveTo("93.184.216.34", "169.254.169.254");
    const urls = watchFetch();
    await expect(remoteFetch("http://mixed.example/")).rejects.toMatchObject({
      code: "source_host_not_allowed",
    });
    resolveTo("::ffff:7f00:1");
    const settings = config as { SOURCES_ALLOW_PRIVATE_HOSTS: boolean };
    settings.SOURCES_ALLOW_PRIVATE_HOSTS = false;
    try {
      for (const url of [
        "http://rebound.example/",
        "http://[::ffff:7f00:1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::7f00:1]/",
        "http://[64:ff9b::7f00:1]/",
        "https://[0:0:0:0:0:ffff:7f00:1]/",
      ]) {
        await expect(remoteFetch(url)).rejects.toMatchObject({ code: "source_host_not_allowed" });
      }
    } finally {
      settings.SOURCES_ALLOW_PRIVATE_HOSTS = true;
    }
    expect(urls()).toEqual([]);
  });

  test("an address that refuses the connection: the next one is tried", async () => {
    // The server listens on 127.0.0.1 only, so [::1] refuses (or has no IPv6).
    resolveTo("::1", "127.0.0.1");
    const urls = watchFetch();
    const res = await remoteFetch(`http://dual.example:${port}/c`, {
      method: "POST",
      body: "a=b",
    });
    expect(await res.text()).toBe("POST /c");
    expect(urls()).toEqual([`http://[::1]:${port}/c`, `http://127.0.0.1:${port}/c`]);
    expect(seen).toEqual([{ path: "/c", host: `dual.example:${port}` }]);
  });

  test("after an error once connected, the request isn't sent again", async () => {
    resolveTo("10.0.0.1", "127.0.0.1");
    const spy = spyOn(globalThis, "fetch").mockImplementationOnce((async () => {
      throw Object.assign(new Error("The socket connection was closed unexpectedly"), {
        code: "ECONNRESET",
      });
    }) as never);
    spies.push(spy);
    await expect(
      remoteFetch(`http://dual.example:${port}/e`, { method: "POST", body: "a=b" }),
    ).rejects.toMatchObject({ code: "source_unreachable" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  test("a closed port is ConnectionRefused, which counts as not connected", async () => {
    const closed = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
    const url = `http://127.0.0.1:${closed.port}/`;
    closed.stop(true);
    await expect(fetch(url)).rejects.toMatchObject({ code: "ConnectionRefused" });
  });

  test("redirects resolve against the name and are checked again", async () => {
    resolveTo("127.0.0.1");
    const res = await remoteFetch(`http://nextcloud.example:${port}/dir/relative`);
    expect(await res.text()).toBe("GET /dir/next");
    expect(seen).toEqual([
      { path: "/dir/relative", host: `nextcloud.example:${port}` },
      { path: "/dir/next", host: `nextcloud.example:${port}` },
    ]);
    for (const path of ["/to-metadata", "/to-nat64"]) {
      await expect(remoteFetch(`http://nextcloud.example:${port}${path}`)).rejects.toMatchObject({
        code: "source_host_not_allowed",
      });
    }
  });

  test("https:// connects by name, so certificate checks bind it to the name", async () => {
    const urls = watchFetch();
    // Nothing speaks TLS there; what matters is what fetch() was asked for.
    await expect(remoteFetch(`https://localhost:${port}/d`)).rejects.toMatchObject({
      code: "source_unreachable",
    });
    expect(urls()).toEqual([`https://localhost:${port}/d`]);
  });
});
