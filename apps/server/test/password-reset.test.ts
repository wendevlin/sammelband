import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { auth } from "../src/auth";
import { db } from "../src/db/client";
import { type Mail, setMailTransport } from "../src/lib/mail";
import { requireMail } from "../src/middleware/mail.middleware";
import { createUser, inTenant } from "./helpers";

let outbox: Mail[] = [];
const REDIRECT = "http://localhost:5173/reset-password";

beforeEach(() => {
  outbox = [];
  setMailTransport({ sendMail: async (m) => outbox.push(m) }, "Sammelband <test@example.com>");
});
afterEach(() => setMailTransport(null));

async function signIn(email: string, password = "password123") {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { ok: res.ok, headers: new Headers({ cookie }) };
}

const requestReset = (email: string) =>
  auth.api.requestPasswordReset({ body: { email, redirectTo: REDIRECT } });

/** The same request over HTTP, as the browser sends it (with its languages). */
const requestResetOverHttp = (email: string, acceptLanguage: string) =>
  auth.handler(
    new Request("http://localhost:3000/api/auth/request-password-reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173",
        "accept-language": acceptLanguage,
      },
      body: JSON.stringify({ email, redirectTo: REDIRECT }),
    }),
  );

/** The token from the link in the last mail. */
function tokenFromMail(): string {
  const mail = outbox.at(-1);
  const token = mail?.text.match(/\/reset-password\/([^?\s]+)/)?.[1];
  if (!token) throw new Error("no reset link in the mail");
  return token;
}

describe("password reset by mail", () => {
  test(
    "the link sets a new password once and signs out everywhere",
    inTenant(async () => {
      const user = await createUser();
      const old = await signIn(user.email);
      await requestReset(user.email);

      expect(outbox).toHaveLength(1);
      expect(outbox[0]?.to).toBe(user.email);
      expect(outbox[0]?.subject).toBe("Reset your Sammelband password");
      expect(outbox[0]?.text).toContain(`callbackURL=${encodeURIComponent(REDIRECT)}`);

      const token = tokenFromMail();
      await auth.api.resetPassword({ body: { newPassword: "brand-new-pass", token } });
      expect(await auth.api.getSession({ headers: old.headers })).toBeNull();
      expect((await signIn(user.email)).ok).toBe(false);
      expect((await signIn(user.email, "brand-new-pass")).ok).toBe(true);

      // A link works once.
      await expect(
        auth.api.resetPassword({ body: { newPassword: "another-pass-1", token } }),
      ).rejects.toThrow();
    }),
  );

  test("an unknown address gets the same answer and no mail", async () => {
    const res = await requestReset("nobody@example.com");
    expect(res.status).toBe(true);
    expect(outbox).toEqual([]);
  });

  test(
    "the mail is in the account's language, else the browser's",
    inTenant(async () => {
      const user = await createUser();
      expect((await requestResetOverHttp(user.email, "de-AT,de;q=0.9")).status).toBe(200);
      expect(outbox.at(-1)?.subject).toBe("Dein Sammelband-Passwort zurücksetzen");

      await db.updateTable("user").set({ locale: "en" }).where("id", "=", user.id).execute();
      await requestResetOverHttp(user.email, "de");
      expect(outbox.at(-1)?.subject).toBe("Reset your Sammelband password");
    }),
  );

  test(
    "names are escaped in the HTML version",
    inTenant(async () => {
      const user = await createUser();
      await db
        .updateTable("user")
        .set({ name: '<img src=x onerror="alert(1)">' })
        .where("id", "=", user.id)
        .execute();
      await requestReset(user.email);
      const html = outbox.at(-1)?.html ?? "";
      expect(html).not.toContain("<img");
      expect(html).toContain("&#60;img");
    }),
  );

  test("without SMTP the request endpoint is closed", async () => {
    const app = new Hono().post("/reset", requireMail, (c) => c.json({ ok: true }));
    expect((await app.request("/reset", { method: "POST" })).status).toBe(200);
    setMailTransport(null);
    const res = await app.request("/reset", { method: "POST" });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "mail_disabled" });
  });
});
