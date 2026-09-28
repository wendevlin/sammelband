import { randomBytes } from "node:crypto";
import { auth } from "../auth";
import { config } from "../config";
import { db } from "../db/client";
import { AppError } from "../lib/errors";

/**
 * First-run onboarding.
 *
 * When the database has no admin user, the server generates a one-time bootstrap
 * code at startup and prints it. The first person to hit /api/onboarding/claim
 * with the correct code creates their account and is promoted to admin.
 *
 * The code lives in process memory only — if the process restarts, a new code
 * is printed. Once consumed, this module's `claim()` rejects further attempts.
 */

let bootstrapCode: string | null = null;
let consumed = false;

async function adminExists(): Promise<boolean> {
  const row = await db
    .selectFrom("user")
    .select("id")
    .where("role", "=", "admin")
    .executeTakeFirst();
  return row !== undefined;
}

export async function initOnboarding(): Promise<void> {
  if (await adminExists()) return;
  // 8 uppercase hex chars — easy to read off a terminal.
  bootstrapCode = randomBytes(4).toString("hex").toUpperCase();
  // In dev the Vite dev server hosts the UI at :5173 with proxies back to us;
  // in prod the backend serves the SPA at BASE_URL.
  const frontendBase = config.isDev ? "http://localhost:5173" : config.BASE_URL;
  const url = `${frontendBase}/?code=${bootstrapCode}`;
  const banner = "═".repeat(72);
  console.log(
    [
      "",
      banner,
      "  No admin user exists yet. To create the first admin, open:",
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

export function getStatus(): { needsOnboarding: boolean } {
  return { needsOnboarding: bootstrapCode !== null && !consumed };
}

export async function claim(input: {
  code: string;
  email: string;
  password: string;
  name?: string;
}): Promise<{ ok: true }> {
  if (consumed) throw new AppError(410, "Onboarding already completed");
  if (!bootstrapCode) throw new AppError(410, "Onboarding not active");
  if (input.code.trim().toUpperCase() !== bootstrapCode) {
    // Don't reveal whether code is wrong vs expired — just reject.
    throw new AppError(401, "Invalid code");
  }
  if (await adminExists()) {
    // Race / double-claim guard.
    consumed = true;
    bootstrapCode = null;
    throw new AppError(410, "Onboarding already completed");
  }

  // Create user via better-auth so password is hashed correctly and the
  // session/account tables get populated as if it were a normal signup.
  const email = input.email.trim().toLowerCase();
  const res = await auth.api.signUpEmail({
    body: { email, password: input.password, name: input.name?.trim() || email },
  });
  await db.updateTable("user").set({ role: "admin" }).where("id", "=", res.user.id).execute();
  // The server-side sign-up opens a session nobody holds; the admin signs in next.
  await db.deleteFrom("session").where("userId", "=", res.user.id).execute();

  consumed = true;
  bootstrapCode = null;
  console.log(`[onboarding] admin account created for ${input.email}`);
  return { ok: true };
}
