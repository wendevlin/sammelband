import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { auth } from "./auth";
import { config } from "./config";
import { migrate } from "./db/migrate";
import { AppError } from "./lib/errors";
import { authRateLimit } from "./middleware/rate-limit.middleware";
import { adminInviteRoutes } from "./routes/admin/invites";
import { adminStorageRoutes } from "./routes/admin/storage";
import { adminUserRoutes } from "./routes/admin/users";
import { albumRoutes } from "./routes/albums";
import { blockRoutes } from "./routes/blocks";
import { folderRoutes } from "./routes/folders";
import { imageRoutes } from "./routes/images";
import { instanceRoutes } from "./routes/instance";
import { inviteRoutes } from "./routes/invites";
import { libraryRoutes } from "./routes/library";
import { onboardingRoutes } from "./routes/onboarding";
import { blockPhotoRoutes, photoRoutes } from "./routes/photos";
import { publicRoutes } from "./routes/public";
import { shareRoutes } from "./routes/shares";
import { spaRoutes } from "./routes/spa";
import { tenantRoutes } from "./routes/tenant";
import { wsRoutes } from "./routes/ws";
import { initOnboarding } from "./services/onboarding.service";
import { reconcileStorage } from "./services/tenant.service";

mkdirSync(join(config.UPLOADS_PATH, "tenants"), { recursive: true });

await migrate();
await reconcileStorage();
await initOnboarding();

const app = new Hono();

app.onError((err, c) => {
  // Error pages of public links stay out of search engines too.
  if (c.req.path.startsWith("/api/public/")) c.header("X-Robots-Tag", "noindex, nofollow");
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.statusCode as ContentfulStatusCode);
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[unhandled]", err);
  return c.json({ error: "Internal server error" }, 500);
});

app.use(
  "*",
  secureHeaders({
    // HSTS belongs to the TLS-terminating proxy; the default includeSubDomains
    // could affect other services on the same domain.
    strictTransportSecurity: false,
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      // SvelteKit's CSP meta tag narrows inline scripts to its bootstrap's hash.
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

// Cross-origin form/multipart posts are rejected. JSON bodies can't be sent
// cross-origin without a CORS preflight, which this server never answers.
app.use("/api/*", csrf({ origin: config.ALLOWED_ORIGINS }));

// Auth. Closed instance: accounts are created by an admin, an invite link or
// the first-run setup, all server-side, so the public sign-up endpoint is blocked.
app.use("/api/auth/*", authRateLimit);
app.post("/api/auth/sign-up/*", (c) =>
  c.json({ error: "Public sign-up is disabled. Ask an admin to create your account." }, 403),
);
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/onboarding", onboardingRoutes);
app.route("/api/invites", inviteRoutes);
app.route("/api/tenant", tenantRoutes);
app.route("/api/folders", folderRoutes);
app.route("/api/library", libraryRoutes);
app.route("/api/albums", albumRoutes);
app.route("/api/albums", blockRoutes);
app.route("/api/blocks", blockPhotoRoutes);
app.route("/api/photos", photoRoutes);
app.route("/api/images", imageRoutes);
app.route("/api/shares", shareRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/admin/users", adminUserRoutes);
app.route("/api/admin/storage", adminStorageRoutes);
app.route("/api/admin/invites", adminInviteRoutes);
app.route("/api/instance", instanceRoutes);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

app.route("/", wsRoutes);
app.route("/", spaRoutes);

Bun.serve({
  hostname: "0.0.0.0",
  port: config.PORT,
  fetch: app.fetch,
  websocket,
  // Photo uploads can be large; Bun's default body limit is 128 MB.
  maxRequestBodySize: 512 * 1024 * 1024,
});

console.log(`[Sammelband] listening on http://localhost:${config.PORT}`);

export type App = typeof app;
