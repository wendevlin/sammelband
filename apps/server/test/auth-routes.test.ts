import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { auth } from "../src/auth";
import { AUTH_ENDPOINTS, authRoutes } from "../src/routes/auth";

/** /api/auth with a stand-in for better-auth, recording which limits ran. */
function setup() {
  const applied: string[] = [];
  const limit = (name: string) =>
    createMiddleware(async (_c, next) => {
      applied.push(name);
      await next();
    });
  const app = new Hono().route(
    "/api/auth",
    authRoutes({
      handler: (req) => Response.json({ forwarded: `${req.method} ${new URL(req.url).pathname}` }),
      limits: {
        credentials: [limit("credentials")],
        "password-reset": [limit("password-reset"), limit("mail")],
      },
    }),
  );
  const send = (method: string, path: string) =>
    app.request(`/api/auth${path}`, {
      method,
      ...(method === "POST" && { body: "{}", headers: { "content-type": "application/json" } }),
    });
  return { send, applied };
}

describe("better-auth endpoints", () => {
  test.each([
    ["GET", "/get-session", []],
    ["POST", "/sign-out", []],
    ["POST", "/sign-in/email", ["credentials"]],
    ["POST", "/two-factor/verify-totp", ["credentials"]],
    ["POST", "/two-factor/verify-backup-code", ["credentials"]],
    ["POST", "/two-factor/enable", ["credentials"]],
    ["POST", "/two-factor/disable", ["credentials"]],
    ["POST", "/two-factor/generate-backup-codes", ["credentials"]],
    ["GET", "/reset-password/abc123?callbackURL=%2Freset-password", ["credentials"]],
    ["POST", "/reset-password", ["credentials"]],
    ["POST", "/request-password-reset", ["password-reset", "mail"]],
  ])("%s %s reaches better-auth, limited by %p", async (method, path, limits) => {
    const { send, applied } = setup();
    const res = await send(method, path);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forwarded: `${method} /api/auth${path.split("?")[0]}` });
    expect(applied).toEqual(limits);
  });

  test.each([
    ["POST", "/update-user"],
    ["POST", "/change-email"],
    ["POST", "/change-password"],
    ["POST", "/delete-user"],
    ["GET", "/list-sessions"],
    ["POST", "/revoke-sessions"],
    ["POST", "/get-session"],
    ["GET", "/sign-in/email"],
    ["POST", "/sign-in/social"],
    ["POST", "/two-factor/get-totp-uri"],
    ["POST", "/two-factor/send-otp"],
    ["POST", "/two-factor/verify-otp"],
    ["GET", "/error"],
    ["GET", "/ok"],
  ])("%s %s answers 404", async (method, path) => {
    const { send, applied } = setup();
    const res = await send(method, path);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_found" });
    expect(applied).toEqual([]);
  });

  test("sign-up stays closed", async () => {
    const { send } = setup();
    const res = await send("POST", "/sign-up/email");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "signup_disabled" });
  });

  test("every allowed endpoint is one better-auth has", () => {
    const endpoints = Object.values(
      auth.api as unknown as Record<string, { path?: string; options?: { method?: unknown } }>,
    );
    for (const { method, path } of AUTH_ENDPOINTS) {
      const match = endpoints.find((e) => e.path === path);
      expect(match, path).toBeDefined();
      expect([match?.options?.method].flat()).toContain(method);
    }
  });

  test("with better-auth itself", async () => {
    const app = new Hono().route(
      "/api/auth",
      authRoutes({ handler: auth.handler, limits: { credentials: [], "password-reset": [] } }),
    );
    const session = await app.request("http://localhost:3000/api/auth/get-session");
    expect(session.status).toBe(200);
    expect(await session.json()).toBeNull();
    // An unknown token sends the browser back to the SPA's page with an error.
    const reset = await app.request(
      "http://localhost:3000/api/auth/reset-password/nope?callbackURL=%2Freset-password",
    );
    expect(reset.status).toBe(302);
    expect(reset.headers.get("location")).toBe(
      "http://localhost:3000/reset-password?error=INVALID_TOKEN",
    );
  });
});
