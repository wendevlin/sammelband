function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

const NODE_ENV = process.env.NODE_ENV ?? "development";
const isDev = NODE_ENV !== "production";

// Origins better-auth accepts for state-changing requests (CSRF allowlist), in
// addition to BASE_URL which is always trusted. In dev the Vite server proxies
// from :5173 with the original Origin header, so it must be trusted explicitly.
// Override via TRUSTED_ORIGINS (comma-separated) when the SPA is hosted apart
// from the API in production.
const trustedOrigins = (() => {
  const fromEnv = optional("TRUSTED_ORIGINS");
  if (fromEnv)
    return fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return isDev ? ["http://localhost:5173"] : [];
})();

export const config = {
  NODE_ENV,
  isDev,
  PORT: Number(process.env.PORT ?? 3000),
  BASE_URL: required("BASE_URL", isDev ? "http://localhost:3000" : undefined),
  TRUSTED_ORIGINS: trustedOrigins,
  SECRET_KEY: required("SECRET_KEY", isDev ? "dev-secret-not-for-production-change-me" : undefined),
  // postgres://… selects PostgreSQL; otherwise SQLite at DATABASE_PATH.
  DATABASE_URL: optional("DATABASE_URL"),
  DATABASE_PATH: process.env.DATABASE_PATH ?? "./sammelband.db",
  UPLOADS_PATH: required("UPLOADS_PATH", isDev ? "./uploads" : undefined),
  FRONTEND_DIST: process.env.FRONTEND_DIST ?? "./dist/frontend",
} as const;

export const SRCSET_WIDTHS = [400, 800, 1200, 1920] as const;
export type SrcsetWidth = (typeof SRCSET_WIDTHS)[number];

export function isSrcsetWidth(n: number): n is SrcsetWidth {
  return (SRCSET_WIDTHS as readonly number[]).includes(n);
}
