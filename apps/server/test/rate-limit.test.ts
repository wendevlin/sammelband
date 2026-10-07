import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import { Hono } from "hono";
import { clientIp, forwardedClientIp, rateLimit } from "../src/middleware/rate-limit.middleware";

/** What clientIp() makes of a request with these headers. */
async function ipOf(proxy: { trust: boolean; hops: number }, headers: Record<string, string>) {
  const app = new Hono().get("/", (c) => c.text(clientIp(c, proxy)));
  return (await app.request("/", { headers })).text();
}

let limiterId = 0;
/** A limiter of its own per test: buckets live for the whole process. */
function testLimit(max: number, key?: (c: Context) => string) {
  limiterId += 1;
  return rateLimit({ name: `test-${limiterId}`, windowMs: 60_000, max, key });
}

describe("client address", () => {
  test("one proxy: the entry it appended, whatever the client sent before it", () => {
    expect(forwardedClientIp("203.0.113.7", undefined, 1)).toBe("203.0.113.7");
    expect(forwardedClientIp("1.2.3.4, 5.6.7.8, 203.0.113.7", undefined, 1)).toBe("203.0.113.7");
    expect(forwardedClientIp(" 1.2.3.4 ,203.0.113.7 ", "9.9.9.9", 1)).toBe("203.0.113.7");
  });

  test("two proxies: the entry the outer one appended", () => {
    expect(forwardedClientIp("203.0.113.7, 10.0.0.2", undefined, 2)).toBe("203.0.113.7");
    expect(forwardedClientIp("spoofed, 203.0.113.7, 10.0.0.2", undefined, 2)).toBe("203.0.113.7");
  });

  test("without enough entries: X-Real-IP, else nothing", () => {
    expect(forwardedClientIp(undefined, "203.0.113.9", 1)).toBe("203.0.113.9");
    expect(forwardedClientIp("", " 203.0.113.9 ", 1)).toBe("203.0.113.9");
    expect(forwardedClientIp("10.0.0.2", "203.0.113.9", 2)).toBe("203.0.113.9");
    expect(forwardedClientIp("10.0.0.2", undefined, 2)).toBeUndefined();
    expect(forwardedClientIp(undefined, undefined, 1)).toBeUndefined();
  });

  test("proxy headers count only with TRUST_PROXY", async () => {
    const headers = { "x-forwarded-for": "1.2.3.4, 203.0.113.7", "x-real-ip": "9.9.9.9" };
    // Outside Bun.serve there is no socket address.
    expect(await ipOf({ trust: false, hops: 1 }, headers)).toBe("unknown");
    expect(await ipOf({ trust: true, hops: 1 }, headers)).toBe("203.0.113.7");
    expect(await ipOf({ trust: true, hops: 2 }, headers)).toBe("1.2.3.4");
    expect(await ipOf({ trust: true, hops: 1 }, {})).toBe("unknown");
  });

  test("a fresh spoofed entry per request doesn't reset the limit", async () => {
    const limit = testLimit(2, (c) => clientIp(c, { trust: true, hops: 1 }));
    const app = new Hono().post("/", limit, (c) => c.json({ ok: true }));
    const send = (spoofed: string) =>
      app.request("/", {
        method: "POST",
        headers: { "x-forwarded-for": `${spoofed}, 203.0.113.7` },
      });
    expect((await send("1.1.1.1")).status).toBe(200);
    expect((await send("2.2.2.2")).status).toBe(200);
    expect((await send("3.3.3.3")).status).toBe(429);
  });
});

describe("rate limits", () => {
  test("a keyed limit counts per key, across addresses", async () => {
    const limit = testLimit(2, (c) => c.req.param("token") ?? "");
    const app = new Hono().post("/:token", limit, (c) => c.json({ ok: true }));
    const send = (token: string, ip: string) =>
      app.request(`/${token}`, { method: "POST", headers: { "x-forwarded-for": ip } });

    expect((await send("a", "1.1.1.1")).status).toBe(200);
    expect((await send("a", "2.2.2.2")).status).toBe(200);
    const blocked = await send("a", "3.3.3.3");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ code: "rate_limited" });
    // Another key has its own bucket.
    expect((await send("b", "3.3.3.3")).status).toBe(200);
  });

  test("failuresOnly counts only failed requests", async () => {
    const limit = rateLimit({
      name: `test-failures-${++limiterId}`,
      windowMs: 60_000,
      max: 2,
      failuresOnly: true,
    });
    const app = new Hono()
      .onError((_err, c) => c.json({}, 500))
      .post("/:outcome", limit, (c) => {
        if (c.req.param("outcome") === "throw") throw new Error("wrong");
        return c.json({}, c.req.param("outcome") === "ok" ? 200 : 401);
      });
    const send = (outcome: string) => app.request(`/${outcome}`, { method: "POST" });

    for (let i = 0; i < 5; i++) expect((await send("ok")).status).toBe(200);
    expect((await send("wrong")).status).toBe(401);
    expect((await send("throw")).status).toBe(500);
    // Two failures: now even a right answer has to wait.
    expect((await send("ok")).status).toBe(429);
  });

  test("without a key, the client address is the key", async () => {
    const limit = testLimit(1);
    const app = new Hono().get("/:x", limit, (c) => c.json({ ok: true }));
    expect((await app.request("/one")).status).toBe(200);
    expect((await app.request("/two")).status).toBe(429);
  });
});
