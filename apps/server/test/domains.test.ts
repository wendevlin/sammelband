import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type Domains, domainRedirect, domainRedirects } from "../src/middleware/domain.middleware";

const domains: Domains = {
  baseUrl: "https://photos.example.com",
  shareUrl: "https://sb.example",
  aliasUrls: ["https://old.example.org", "http://localhost:8080"],
};

const TOKEN = "AbC_123-xyzAbC_123-xyzAbC_123-xy";

const redirect = (url: string) => {
  const u = new URL(url);
  return domainRedirect(domains, u, u.host)?.location ?? null;
};

describe("domainRedirect", () => {
  test("serves the main address and unknown hosts", () => {
    expect(redirect("https://photos.example.com/s/abc")).toBeNull();
    expect(redirect("http://10.0.0.5:3000/")).toBeNull();
  });

  test("aliases move every path, with its query, to the main address", () => {
    expect(redirect(`https://old.example.org/s/${TOKEN}?v=123`)).toBe(
      `https://photos.example.com/s/${TOKEN}?v=123`,
    );
    expect(redirect("https://old.example.org/albums/x")).toBe(
      "https://photos.example.com/albums/x",
    );
    expect(redirect("http://localhost:8080/")).toBe("https://photos.example.com/");
  });

  test("the share domain opens /<token> as a share page", () => {
    expect(redirect(`https://sb.example/${TOKEN}`)).toBe(`https://photos.example.com/s/${TOKEN}`);
    expect(redirect(`https://sb.example/${TOKEN}/?v=7`)).toBe(
      `https://photos.example.com/s/${TOKEN}?v=7`,
    );
    expect(redirect(`https://sb.example/s/${TOKEN}/albums/a1`)).toBe(
      `https://photos.example.com/s/${TOKEN}/albums/a1`,
    );
    expect(redirect("https://sb.example/")).toBe("https://photos.example.com/");
    expect(redirect("https://sb.example/robots.txt")).toBe("https://photos.example.com/robots.txt");
  });

  test("never leaves the main address", () => {
    expect(redirect("https://old.example.org//evil.example/x?a=1")).toBe(
      "https://photos.example.com//evil.example/x?a=1",
    );
    expect(redirect("https://sb.example//evil.example")).toBe(
      "https://photos.example.com//evil.example",
    );
  });

  test("hosts match regardless of case", () => {
    const u = new URL("https://old.example.org/x");
    expect(domainRedirect(domains, u, "OLD.Example.org")?.location).toBe(
      "https://photos.example.com/x",
    );
  });

  test("without a share domain only aliases redirect", () => {
    const u = new URL(`https://sb.example/${TOKEN}`);
    expect(domainRedirect({ ...domains, shareUrl: undefined }, u, u.host)).toBeNull();
  });
});

describe("domainRedirects", () => {
  const app = new Hono().use("*", domainRedirects(domains)).all("*", (c) => c.text("here"));
  const request = (url: string, init?: RequestInit) =>
    app.request(url, { ...init, headers: { host: new URL(url).host } });

  test("answers aliases with a permanent redirect that keeps the method", async () => {
    const res = await request("https://old.example.org/api/x", { method: "POST" });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://photos.example.com/api/x");
  });

  test("answers the share domain with a temporary redirect", async () => {
    const res = await request(`https://sb.example/${TOKEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://photos.example.com/s/${TOKEN}`);
  });

  test("serves the main address", async () => {
    const res = await request("https://photos.example.com/s/x");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("here");
  });
});
