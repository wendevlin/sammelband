import { Hono } from "hono";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as tenantService from "../services/tenant.service";

/** The signed-in user's Sammelband. */
export const tenantRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json(await tenantService.currentTenant()));
