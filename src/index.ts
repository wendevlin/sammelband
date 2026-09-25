import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Elysia, ElysiaCustomStatusResponse, status } from "elysia";
import { auth } from "./auth";
import { config } from "./config";
import { runMigrations } from "./db/client";
import { AppError } from "./lib/errors";
import { authRateLimit } from "./middleware/rate-limit.middleware";
import { adminAlbumsRoutes } from "./routes/admin/albums";
import { adminBlocksRoutes } from "./routes/admin/blocks";
import { adminFoldersRoutes } from "./routes/admin/folders";
import { adminGrantsRoutes } from "./routes/admin/grants";
import { adminPhotosRoutes } from "./routes/admin/photos";
import { adminSharesRoutes } from "./routes/admin/shares";
import { adminStorageRoutes } from "./routes/admin/storage";
import { adminUsersRoutes } from "./routes/admin/users";
import { adminImageRoutes, variantRoutes } from "./routes/images";
import { onboardingRoutes } from "./routes/onboarding";
import { shareRoutes } from "./routes/share";
import { userRoutes } from "./routes/user";
import { wsRoutes } from "./routes/ws";
import { initOnboarding } from "./services/onboarding.service";

mkdirSync(join(config.UPLOADS_PATH, "originals"), { recursive: true });
mkdirSync(join(config.UPLOADS_PATH, "variants"), { recursive: true });

runMigrations();
initOnboarding();

const app = new Elysia({
  serve: {
    hostname: "0.0.0.0",
  },
})
  .onError(({ error, code }) => {
    if (error instanceof ElysiaCustomStatusResponse) return error;
    if (error instanceof AppError) {
      return status(error.statusCode, { error: error.message });
    }
    if (code === "VALIDATION") {
      return status(400, { error: String(error) });
    }
    console.error("[unhandled]", error);
    return status(500, { error: "Internal server error" });
  })
  .get("/health", () => ({ ok: true }))
  .use(onboardingRoutes)
  .group("/api/auth", (a) =>
    a
      .use(authRateLimit)
      // Closed instance: public registration is disabled. Accounts are created
      // by an admin (POST /admin/users) or by the first-run onboarding claim,
      // both of which call auth.api.signUpEmail server-side and bypass this guard.
      .onRequest(({ request, set }) => {
        if (
          request.method === "POST" &&
          new URL(request.url).pathname === "/api/auth/sign-up/email"
        ) {
          set.status = 403;
          return {
            error:
              "Public sign-up is disabled. Ask an admin to create your account.",
          };
        }
      })
      .mount(auth.handler),
  )
  // Public share route (already namespaced at /api/share)
  .use(shareRoutes)
  // All other resource routes live under /api so they never collide with SPA
  // routes. The .group prefix applies to these .use()d routers, turning e.g.
  // /admin/storage into /api/admin/storage and /images/:f into /api/images/:f.
  .group("/api", (api) =>
    api
      // Admin routes
      .use(adminFoldersRoutes)
      .use(adminAlbumsRoutes)
      .use(adminPhotosRoutes)
      .use(adminBlocksRoutes)
      .use(adminGrantsRoutes)
      .use(adminSharesRoutes)
      .use(adminStorageRoutes)
      .use(adminUsersRoutes)
      .use(adminImageRoutes)
      // User-facing routes
      .use(userRoutes)
      // Image variants (auth via session OR sb_share cookie)
      .use(variantRoutes),
  )
  // Subscriptions
  .use(wsRoutes)
  .listen(config.PORT);

console.log(`[Sammelband] listening on http://localhost:${config.PORT}`);

export type App = typeof app;
