import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
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
import { onboardingRoutes } from "./routes/onboarding";
import { photoRoutes } from "./routes/photos";
import { spaRoutes } from "./routes/spa";
import { tenantRoutes } from "./routes/tenant";
import { wsRoutes } from "./routes/ws";
import { initOnboarding } from "./services/onboarding.service";

mkdirSync(join(config.UPLOADS_PATH, "tenants"), { recursive: true });

await migrate();
await initOnboarding();

const allowedOrigins = [
  new URL(config.BASE_URL).origin,
  ...config.TRUSTED_ORIGINS.map((o) => new URL(o).origin),
];

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.statusCode as ContentfulStatusCode);
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[unhandled]", err);
  return c.json({ error: "Internal server error" }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));

// Cross-origin form/multipart posts are rejected. JSON bodies can't be sent
// cross-origin without a CORS preflight, which this server never answers.
app.use("/api/*", csrf({ origin: allowedOrigins }));

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
app.route("/api/albums", albumRoutes);
app.route("/api/albums", blockRoutes);
app.route("/api", photoRoutes);
app.route("/api/images", imageRoutes);
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
