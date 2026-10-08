import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { config } from "../src/config";
import {
  AVATAR_BODY_LIMIT,
  apiBodyLimit,
  bodyLimitFor,
  DEFAULT_BODY_LIMIT,
  MAX_BODY_LIMIT,
  PHOTO_UPLOAD_BODY_LIMIT,
} from "../src/middleware/body-limit.middleware";

const MB = 1024 * 1024;

/** An app behind the limits that reads whatever body it gets. */
function appWith(signedIn: boolean) {
  return new Hono()
    .use(
      "/api/*",
      apiBodyLimit(async () => signedIn),
    )
    .post("/api/*", async (c) => c.json({ size: (await c.req.arrayBuffer()).byteLength }));
}

/** A body of `size` bytes in 64 KB chunks, with no declared length. */
function chunked(size: number): RequestInit {
  let left = size;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (left <= 0) return controller.close();
      const n = Math.min(left, 64 * 1024);
      left -= n;
      controller.enqueue(new Uint8Array(n));
    },
  });
  return { method: "POST", body, duplex: "half" } as RequestInit;
}

/** A body of `size` bytes with its Content-Length, as browsers send it. */
function declared(size: number): RequestInit {
  return {
    method: "POST",
    body: new Uint8Array(size),
    headers: { "content-length": String(size) },
  };
}

describe("request body limits", () => {
  test("only the upload routes take more than the default", () => {
    expect(bodyLimitFor("POST", "/api/sections/s1/photos")).toBe(PHOTO_UPLOAD_BODY_LIMIT);
    expect(bodyLimitFor("POST", "/api/profile/avatar")).toBe(AVATAR_BODY_LIMIT);
    expect(bodyLimitFor("POST", "/api/admin/users/u1/avatar")).toBe(AVATAR_BODY_LIMIT);
    for (const [method, path] of [
      ["POST", "/api/sections/s1/photos/reorder"],
      ["PATCH", "/api/sections/s1/photos"],
      ["POST", "/api/sections/s1/import"],
      ["POST", "/api/sections/a/b/photos"],
      ["POST", "/api/sections//photos"],
      ["POST", "/api/profile/avatar/x"],
      ["POST", "/api/profile"],
      ["POST", "/api/admin/users/u1/password"],
      ["POST", "/api/public/token/unlock"],
      ["POST", "/api/auth/sign-in/email"],
      ["POST", "/api/onboarding/claim"],
    ] as const) {
      expect(bodyLimitFor(method, path)).toBe(DEFAULT_BODY_LIMIT);
    }
  });

  test("sizes", () => {
    expect(DEFAULT_BODY_LIMIT).toBe(1 * MB);
    // One photo of the largest allowed size always fits in an upload.
    expect(PHOTO_UPLOAD_BODY_LIMIT).toBeGreaterThan(config.MAX_UPLOAD_BYTES);
    expect(AVATAR_BODY_LIMIT).toBeGreaterThan(5 * MB);
    // Bun's hard cap leaves room for every route's limit.
    expect(MAX_BODY_LIMIT).toBe(PHOTO_UPLOAD_BODY_LIMIT);
  });

  test("over the default: 413 payload_too_large, declared or chunked", async () => {
    const app = appWith(true);
    for (const init of [declared(DEFAULT_BODY_LIMIT + 1), chunked(DEFAULT_BODY_LIMIT + 1)]) {
      const res = await app.request("/api/public/token/unlock", init);
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ code: "payload_too_large", params: { maxMb: 1 } });
    }
    for (const init of [declared(DEFAULT_BODY_LIMIT), chunked(DEFAULT_BODY_LIMIT)]) {
      const res = await app.request("/api/public/token/unlock", init);
      expect(await res.json()).toEqual({ size: DEFAULT_BODY_LIMIT });
    }
  });

  test("uploads take more", async () => {
    const app = appWith(true);
    const ok = await app.request("/api/profile/avatar", declared(2 * MB));
    expect(await ok.json()).toEqual({ size: 2 * MB });
    const tooLarge = await app.request("/api/admin/users/u1/avatar", declared(7 * MB));
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ params: { maxMb: 6 } });
    // A declared length is checked before anything is read.
    const huge = await app.request("/api/sections/s1/photos", {
      method: "POST",
      body: new Uint8Array(1),
      headers: { "content-length": String(PHOTO_UPLOAD_BODY_LIMIT + 1) },
    });
    expect(huge.status).toBe(413);
  });

  test("an upload of unknown length gets more only from a signed-in user", async () => {
    // Reading it to count would buffer it before the route's sign-in check.
    const anonymous = await appWith(false).request("/api/profile/avatar", chunked(2 * MB));
    expect(anonymous.status).toBe(413);
    const signedIn = await appWith(true).request("/api/profile/avatar", chunked(2 * MB));
    expect(await signedIn.json()).toEqual({ size: 2 * MB });
    // With a declared length nothing is buffered, so no session is needed.
    const declaredAnonymous = await appWith(false).request("/api/profile/avatar", declared(2 * MB));
    expect(declaredAnonymous.status).toBe(200);
  });
});
