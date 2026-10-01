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
import { errorBody } from "./lib/error-codes";
import { AppError } from "./lib/errors";
import { checkMailOnStartup } from "./lib/mail";
import { requireMail } from "./middleware/mail.middleware";
import { authRateLimit, passwordResetRateLimit } from "./middleware/rate-limit.middleware";
import { adminInviteRoutes } from "./routes/admin/invites";
import { adminStorageRoutes } from "./routes/admin/storage";
import { adminUserRoutes } from "./routes/admin/users";
import { albumRoutes } from "./routes/albums";
import { folderRoutes } from "./routes/folders";
import { imageRoutes } from "./routes/images";
import { instanceRoutes } from "./routes/instance";
import { inviteRoutes } from "./routes/invites";
import { libraryRoutes } from "./routes/library";
import { onboardingRoutes } from "./routes/onboarding";
import { photoRoutes, sectionPhotoRoutes } from "./routes/photos";
import { avatarRoutes, profileRoutes } from "./routes/profile";
import { publicRoutes } from "./routes/public";
import { sectionRoutes } from "./routes/sections";
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
void checkMailOnStartup();

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(
      { error: err.message, code: err.code, ...(err.params && { params: err.params }) },
      err.statusCode as ContentfulStatusCode,
    );
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[unhandled]", err);
  return c.json(errorBody("internal_error"), 500);
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

// A private app: ask every crawler not to index or train on anything. Public
// share links keep their link previews (see robots.txt and routes/spa.ts).
app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("X-Robots-Tag")) {
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive, noimageindex, noai, noimageai");
  }
});

// Cross-origin form/multipart posts are rejected. JSON bodies can't be sent
// cross-origin without a CORS preflight, which this server never answers.
app.use("/api/*", csrf({ origin: config.ALLOWED_ORIGINS }));

// Auth. Closed instance: accounts are created by an admin, an invite link or
// the first-run setup, all server-side, so the public sign-up endpoint is blocked.
app.use("/api/auth/*", authRateLimit);
app.post("/api/auth/sign-up/*", (c) => c.json(errorBody("signup_disabled"), 403));
// "Forgot password?" needs SMTP (see lib/mail.ts).
app.post("/api/auth/request-password-reset", passwordResetRateLimit, requireMail);
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.route("/api/onboarding", onboardingRoutes);
app.route("/api/invites", inviteRoutes);
app.route("/api/tenant", tenantRoutes);
app.route("/api/profile", profileRoutes);
app.route("/api/avatars", avatarRoutes);
app.route("/api/folders", folderRoutes);
app.route("/api/library", libraryRoutes);
app.route("/api/albums", albumRoutes);
app.route("/api/albums", sectionRoutes);
app.route("/api/sections", sectionPhotoRoutes);
app.route("/api/photos", photoRoutes);
app.route("/api/images", imageRoutes);
app.route("/api/shares", shareRoutes);
app.route("/api/public", publicRoutes);
app.route("/api/admin/users", adminUserRoutes);
app.route("/api/admin/storage", adminStorageRoutes);
app.route("/api/admin/invites", adminInviteRoutes);
app.route("/api/instance", instanceRoutes);
app.all("/api/*", (c) => c.json(errorBody("not_found"), 404));

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
