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

function adminExists(): boolean {
  const row = db
    .query("SELECT 1 AS ok FROM user WHERE role = 'admin' LIMIT 1")
    .get();
  return row !== null;
}

export function initOnboarding(): void {
  if (adminExists()) return;
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
  if (adminExists()) {
    // Race / double-claim guard.
    consumed = true;
    bootstrapCode = null;
    throw new AppError(410, "Onboarding already completed");
  }

  // Create user via better-auth so password is hashed correctly and the
  // session/account tables get populated as if it were a normal signup.
  await auth.api.signUpEmail({
    body: {
      email: input.email,
      password: input.password,
      name: input.name ?? input.email,
    },
  });

  db.run("UPDATE user SET role = 'admin' WHERE email = ?", [input.email]);

  consumed = true;
  bootstrapCode = null;
  console.log(`[onboarding] admin account created for ${input.email}`);
  return { ok: true };
}
