import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../../lib/validate";
import { type AuthEnv, requireAdmin } from "../../middleware/auth.middleware";
import * as sourceService from "../../services/source.service";

/** Photo sources of the admin's Sammelband: switch them on and configure them. */
export const adminSourceRoutes = new Hono<AuthEnv>()
  .use("*", requireAdmin)
  .get("/", async (c) => c.json(await sourceService.listSettings()))
  .put(
    "/:id",
    validate(
      "json",
      z.object({
        enabled: z.boolean(),
        config: z.record(z.string(), z.string().max(2000)).default({}),
      }),
    ),
    async (c) => c.json(await sourceService.saveSettings(c.req.param("id"), c.req.valid("json"))),
  );
