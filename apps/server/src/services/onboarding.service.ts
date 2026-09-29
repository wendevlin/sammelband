import { randomBytes } from "node:crypto";
import { appUrl, config } from "../config";
import { db } from "../db/client";
import { fail } from "../lib/errors";
import { mailEnabled } from "../lib/mail";
import { createFirstTenant } from "./tenant.service";
import { createAccount } from "./user.service";

/**
 * First-run onboarding.
 *
 * When the instance has no superadmin, the server generates a one-time bootstrap
 * code at startup and prints it. The first person to hit /api/onboarding/claim
 * with the correct code becomes the superadmin and admin of the first
 * Sammelband, which the claim creates.
 *
 * The code lives in process memory only — if the process restarts, a new code
 * is printed. Once consumed, this module's `claim()` rejects further attempts.
 */

let bootstrapCode: string | null = null;
let consumed = false;

async function superadminExists(): Promise<boolean> {
  const row = await db
    .selectFrom("user")
    .select("id")
    .where("superadmin", "=", true)
    .executeTakeFirst();
  return row !== undefined;
}

export async function initOnboarding(): Promise<void> {
  if (await superadminExists()) return;
  // 8 uppercase hex chars — easy to read off a terminal.
  bootstrapCode = randomBytes(4).toString("hex").toUpperCase();
  const url = appUrl(`/?code=${bootstrapCode}`);
  const banner = "═".repeat(72);
  console.log(
    [
      "",
      banner,
      "  No instance owner exists yet. To set up Sammelband, open:",
      "",
      `      ${url}`,
      "",
      `  Or enter the code manually: ${bootstrapCode}`,
      "",
      "  This code is shown only here, only this run. Restart to regenerate.",
      banner,
      "",
    ].join("\n"),
  );
}

/** What the web app needs before sign-in: setup pending, several Sammelbände, mail. */
export function getStatus(): { needsOnboarding: boolean; multiTenant: boolean; mail: boolean } {
  return {
    needsOnboarding: bootstrapCode !== null && !consumed,
    multiTenant: config.MULTI_TENANT,
    mail: mailEnabled(),
  };
}

export async function claim(input: {
  code: string;
  email: string;
  password: string;
  name?: string;
  sammelband: string;
  timezone?: string;
}): Promise<{ ok: true }> {
  if (consumed) throw fail("setup_completed");
  if (!bootstrapCode) throw fail("setup_not_active");
  if (input.code.trim().toUpperCase() !== bootstrapCode) {
    // Don't reveal whether code is wrong vs expired — just reject.
    throw fail("invalid_setup_code");
  }
  // Taken before the first await, so a concurrent claim sees it as consumed.
  consumed = true;
  if (await superadminExists()) {
    bootstrapCode = null;
    throw fail("setup_completed");
  }

  const tenant = await createFirstTenant(input.sammelband, input.timezone);
  try {
    await createAccount({
      tenantId: tenant.id,
      email: input.email,
      name: input.name ?? "",
      password: input.password,
      role: "admin",
      superadmin: true,
    });
  } catch (err) {
    await db.deleteFrom("tenants").where("id", "=", tenant.id).execute();
    consumed = false;
    throw err;
  }
  bootstrapCode = null;
  console.log(`[onboarding] instance owner created: ${input.email}`);
  return { ok: true };
}
