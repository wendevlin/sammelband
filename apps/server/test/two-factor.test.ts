import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { auth } from "../src/auth";
import { db } from "../src/db/client";
import { runInTenant } from "../src/lib/tenant-context";
import { type AuthEnv, requireAuth, requireSession } from "../src/middleware/auth.middleware";
import * as tenantService from "../src/services/tenant.service";
import * as twoFactorService from "../src/services/two-factor.service";
import * as userService from "../src/services/user.service";
import { createTenant, createUser } from "./helpers";

/** The cookies a better-auth response sets, as a request Cookie header. */
function cookiesOf(res: Response): Headers {
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

async function signIn(email: string) {
  const res = await auth.api.signInEmail({
    body: { email, password: "password123" },
    asResponse: true,
  });
  return { body: await res.json(), headers: cookiesOf(res) };
}

/** RFC 6238 code for the secret of an otpauth:// URI, like an authenticator app. */
function totp(uri: string, at = Date.now()): string {
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "")) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** A signed-in user who turned on two-factor authentication. */
async function withTwoFactor(role: "admin" | "user" = "user") {
  const user = await createUser(role);
  const { headers } = await signIn(user.email);
  const { totpURI, backupCodes } = await auth.api.enableTwoFactor({
    body: { password: "password123" },
    headers,
  });
  const verified = await auth.api.verifyTOTP({
    body: { code: totp(totpURI) },
    headers,
    asResponse: true,
  });
  return { user, totpURI, backupCodes, headers: cookiesOf(verified) };
}

/** A minimal app behind the guards, to see what a request gets through. */
const app = new Hono<AuthEnv>()
  .get("/content", requireAuth, (c) => c.json({ ok: true }))
  .get("/setup", requireSession, (c) => c.json({ ok: true }));

describe("two-factor authentication", () => {
  test("setup, then sign-in needs a code or a backup code", async () => {
    const tenant = await createTenant();
    await runInTenant(tenant.id, async () => {
      const { user, totpURI, backupCodes } = await withTwoFactor();
      expect((await userService.getUser(user.id))?.twoFactorEnabled).toBe(true);

      // The password alone no longer creates a session.
      const first = await signIn(user.email);
      expect(first.body).toMatchObject({ twoFactorRedirect: true });
      expect(await auth.api.getSession({ headers: first.headers })).toBeNull();
      await expect(
        auth.api.verifyTOTP({ body: { code: "000000" }, headers: first.headers }),
      ).rejects.toThrow();
      const res = await auth.api.verifyTOTP({
        body: { code: totp(totpURI) },
        headers: first.headers,
        asResponse: true,
      });
      expect((await auth.api.getSession({ headers: cookiesOf(res) }))?.user.id).toBe(user.id);

      // A backup code works once.
      const code = backupCodes[0] ?? "";
      const second = await signIn(user.email);
      await auth.api.verifyBackupCode({ body: { code }, headers: second.headers });
      const third = await signIn(user.email);
      await expect(
        auth.api.verifyBackupCode({ body: { code }, headers: third.headers }),
      ).rejects.toThrow();
    });
  });

  test("a tenant's requirement blocks content until the user sets it up", async () => {
    const tenant = await createTenant();
    await runInTenant(tenant.id, async () => {
      const admin = await withTwoFactor("admin");
      const user = await createUser();
      const { headers } = await signIn(user.email);
      expect((await app.request("/content", { headers })).status).toBe(200);

      await twoFactorService.setRequiredForTenant({ twoFactorEnabled: true }, true);
      expect((await tenantService.currentTenant()).two_factor_required).toBe(true);
      const blocked = await app.request("/content", { headers });
      expect(blocked.status).toBe(403);
      expect(await blocked.json()).toMatchObject({ code: "two_factor_setup_required" });
      expect((await app.request("/setup", { headers })).status).toBe(200);
      // Users who have it aren't affected.
      expect((await app.request("/content", { headers: admin.headers })).status).toBe(200);

      const { totpURI } = await auth.api.enableTwoFactor({
        body: { password: "password123" },
        headers,
      });
      const verified = await auth.api.verifyTOTP({
        body: { code: totp(totpURI) },
        headers,
        asResponse: true,
      });
      expect((await app.request("/content", { headers: cookiesOf(verified) })).status).toBe(200);
    });
  });

  test("only admins who use it themselves can require it", async () => {
    const tenant = await createTenant();
    await runInTenant(tenant.id, async () => {
      await expect(
        twoFactorService.setRequiredForTenant({ twoFactorEnabled: false }, true),
      ).rejects.toThrow("Nice try");
      await expect(
        twoFactorService.setRequiredForInstance({ twoFactorEnabled: false }, true),
      ).rejects.toThrow("Nice try");
      // Turning it off needs no 2FA of your own.
      await twoFactorService.setRequiredForTenant({ twoFactorEnabled: false }, false);
    });
  });

  test("it can't be turned off where it's required", async () => {
    const tenant = await createTenant();
    await runInTenant(tenant.id, async () => {
      const { headers } = await withTwoFactor("admin");
      await twoFactorService.setRequiredForTenant({ twoFactorEnabled: true }, true);
      await expect(
        auth.api.disableTwoFactor({ body: { password: "password123" }, headers }),
      ).rejects.toThrow("can't be turned off");
      await twoFactorService.setRequiredForTenant({ twoFactorEnabled: true }, false);
      await auth.api.disableTwoFactor({ body: { password: "password123" }, headers });
    });
  });

  test("the instance requirement applies to every tenant", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    await twoFactorService.setRequiredForInstance({ twoFactorEnabled: true }, true);
    expect(await twoFactorService.isRequired(a.id)).toBe(true);
    expect(await twoFactorService.isRequired(b.id)).toBe(true);
    const info = await runInTenant(b.id, () => tenantService.currentTenant());
    expect(info).toMatchObject({
      two_factor_required: false,
      two_factor_required_by_instance: true,
    });
    expect((await tenantService.instanceStats()).two_factor_required).toBe(true);
    await twoFactorService.setRequiredForInstance({ twoFactorEnabled: false }, false);
    expect(await twoFactorService.isRequired(a.id)).toBe(false);
  });

  test("an admin resets a user's two-factor authentication, not their own", async () => {
    const tenant = await createTenant();
    await runInTenant(tenant.id, async () => {
      const admin = await createUser("admin");
      const { user } = await withTwoFactor();
      const reset = await userService.resetTwoFactor(admin.id, user.id);
      expect(reset.twoFactorEnabled).toBe(false);
      expect(
        await db.selectFrom("twoFactor").select("id").where("userId", "=", user.id).execute(),
      ).toEqual([]);
      // The password alone signs in again.
      expect((await signIn(user.email)).body).not.toHaveProperty("twoFactorRedirect");
      await expect(userService.resetTwoFactor(admin.id, admin.id)).rejects.toThrow("profile");
    });
    // Other tenants' admins can't reach the user.
    const other = await createTenant("Other");
    const outsider = await runInTenant(other.id, () => createUser("admin"));
    const victim = await runInTenant(tenant.id, () => withTwoFactor());
    await runInTenant(other.id, async () => {
      await expect(userService.resetTwoFactor(outsider.id, victim.user.id)).rejects.toThrow(
        "not found",
      );
    });
  });
});
