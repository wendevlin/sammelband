import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { authRateLimit } from "../middleware/rate-limit.middleware";
import * as inviteService from "../services/invite.service";

/** Public: open an invite link and create an account with it. */
export const inviteRoutes = new Hono()
  .use("*", authRateLimit)
  .get("/:token", async (c) => c.json(await inviteService.describeInvite(c.req.param("token"))))
  .post(
    "/:token/accept",
    validate(
      "json",
      z.object({
        email: z.email(),
        name: z.string().trim().min(1).max(200),
        password: z.string().min(8).max(128),
        /** Admin invites only: rename the Sammelband. */
        sammelband: z.string().trim().min(1).max(100).optional(),
      }),
    ),
    async (c) =>
      c.json(await inviteService.acceptInvite(c.req.param("token"), c.req.valid("json")), 201),
  );
