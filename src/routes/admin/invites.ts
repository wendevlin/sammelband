import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../../lib/validate";
import { type AuthEnv, requireAdmin } from "../../middleware/auth.middleware";
import * as inviteService from "../../services/invite.service";

/** Tenant admin: invite links into the own Sammelband. */
export const adminInviteRoutes = new Hono<AuthEnv>()
  .use("*", requireAdmin)
  .post("/", validate("json", z.object({ role: z.enum(["admin", "user"]) })), async (c) =>
    c.json(await inviteService.createTenantInvite(c.req.valid("json").role), 201),
  )
  .delete("/", async (c) => {
    await inviteService.revokeTenantInvites();
    return c.json({ ok: true });
  });
