import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAdmin, requireAuth } from "../middleware/auth.middleware";
import * as tenantService from "../services/tenant.service";

/** The signed-in user's Sammelband. */
export const tenantRoutes = new Hono<AuthEnv>()
  .get("/", requireAuth, async (c) => c.json(await tenantService.currentTenant()))
  // Tenant admins: settings of their own Sammelband.
  .patch(
    "/",
    requireAdmin,
    validate(
      "json",
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        timezone: z.string().max(64).optional(),
      }),
    ),
    async (c) => c.json(await tenantService.updateCurrentTenant(c.req.valid("json"))),
  );
