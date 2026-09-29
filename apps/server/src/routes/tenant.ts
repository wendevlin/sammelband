import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAdmin, requireSession } from "../middleware/auth.middleware";
import * as tenantService from "../services/tenant.service";
import * as twoFactorService from "../services/two-factor.service";

/** The signed-in user's Sammelband. */
export const tenantRoutes = new Hono<AuthEnv>()
  // Also while a required two-factor setup is pending: the web app reads it to show that.
  .get("/", requireSession, async (c) => c.json(await tenantService.currentTenant()))
  // Tenant admins: settings of their own Sammelband.
  .patch(
    "/",
    requireAdmin,
    validate(
      "json",
      z.object({
        name: z.string().trim().min(1).max(100).optional(),
        timezone: z.string().max(64).optional(),
        twoFactorRequired: z.boolean().optional(),
      }),
    ),
    async (c) => {
      const { twoFactorRequired, ...patch } = c.req.valid("json");
      if (twoFactorRequired !== undefined) {
        await twoFactorService.setRequiredForTenant(c.get("user"), twoFactorRequired);
      }
      return c.json(await tenantService.updateCurrentTenant(patch));
    },
  );
