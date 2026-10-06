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

// Production secrets sign sessions and share-link cookies: require real entropy.
const secretKey = required(
  "SECRET_KEY",
  isDev ? "dev-secret-not-for-production-change-me" : undefined,
);
if (!isDev && secretKey.length < 32) {
  throw new Error("SECRET_KEY must be at least 32 characters (e.g. openssl rand -hex 32)");
}

const baseUrl = required("BASE_URL", isDev ? "http://localhost:3000" : undefined);

// Outgoing email over SMTP (password reset links). Optional: without SMTP_HOST
// the app sends no mail and hides "Forgot password?".
const smtp = (() => {
  const host = optional("SMTP_HOST");
  if (!host) return null;
  // Port 465 speaks TLS from the start; 587 and 25 upgrade with STARTTLS.
  const secure = process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : process.env.SMTP_PORT === "465";
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? (secure ? 465 : 587)),
    secure,
    user: optional("SMTP_USER"),
    password: optional("SMTP_PASSWORD"),
    /** Sender, e.g. `Sammelband <sammelband@example.com>`. */
    from: required("SMTP_FROM"),
  };
})();

export const config = {
  NODE_ENV,
  isDev,
  PORT: Number(process.env.PORT ?? 3000),
  BASE_URL: baseUrl,
  TRUSTED_ORIGINS: trustedOrigins,
  /** Origins allowed to make state-changing requests and open the WebSocket. */
  ALLOWED_ORIGINS: [baseUrl, ...trustedOrigins].map((o) => new URL(o).origin),
  SECRET_KEY: secretKey,
  // Honor X-Forwarded-For / X-Real-IP for rate limiting. Only enable behind a
  // reverse proxy that sets these headers itself.
  TRUST_PROXY: process.env.TRUST_PROXY === "true",
  // Host several independent Sammelbände (tenants) on this instance. Off by
  // default: one Sammelband, no tenant management. Existing tenants keep
  // working if it is switched off again; only managing them is hidden.
  MULTI_TENANT: process.env.MULTI_TENANT === "true",
  // Photo sources (Nextcloud) on private addresses: home networks, Tailscale,
  // the same host. Off unless switched on: anyone who connects an account picks
  // the server, and could otherwise make this one probe its own network.
  SOURCES_ALLOW_PRIVATE_HOSTS: process.env.SOURCES_ALLOW_PRIVATE_HOSTS === "true",
  /** Largest accepted photo upload. */
  MAX_UPLOAD_BYTES: Number(process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024,
  // postgres://… selects PostgreSQL; otherwise SQLite at DATABASE_PATH.
  DATABASE_URL: optional("DATABASE_URL"),
  DATABASE_PATH: process.env.DATABASE_PATH ?? "./sammelband.db",
  UPLOADS_PATH: required("UPLOADS_PATH", isDev ? "./uploads" : undefined),
  FRONTEND_DIST: process.env.FRONTEND_DIST ?? "./dist/frontend",
  SMTP: smtp,
} as const;

/**
 * Absolute URL of a page in the SPA, for links printed or handed out (setup,
 * invites). In dev the Vite server hosts the UI at :5173.
 */
export function appUrl(path: string): string {
  return new URL(path, config.isDev ? "http://localhost:5173" : config.BASE_URL).href;
}

export const SRCSET_WIDTHS = [400, 800, 1200, 1920] as const;
export type SrcsetWidth = (typeof SRCSET_WIDTHS)[number];

export function isSrcsetWidth(n: number): n is SrcsetWidth {
  return (SRCSET_WIDTHS as readonly number[]).includes(n);
}
