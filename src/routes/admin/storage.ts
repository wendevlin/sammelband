import { Hono } from "hono";
import { type AuthEnv, requireAdmin } from "../../middleware/auth.middleware";
import * as storageService from "../../services/storage.service";

export const adminStorageRoutes = new Hono<AuthEnv>()
  .use("*", requireAdmin)
  .get("/", (c) => c.json(storageService.getStorageStats()))
  .post("/clear-cache", (c) => c.json(storageService.clearVariantsCache()));
