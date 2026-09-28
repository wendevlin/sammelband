import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import { authRateLimit, uploadRateLimit } from "../middleware/rate-limit.middleware";
import * as profileService from "../services/profile.service";

const password = z.string().min(8).max(128);

/** The signed-in user's own account. */
export const profileRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .patch(
    "/",
    // Password checks inside: limit guesses.
    authRateLimit,
    validate(
      "json",
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        email: z.email().optional(),
        currentPassword: z.string().max(128).optional(),
      }),
    ),
    async (c) => {
      await profileService.updateProfile(c.get("user").id, c.req.raw.headers, c.req.valid("json"));
      return c.json({ ok: true });
    },
  )
  .post(
    "/password",
    authRateLimit,
    validate("json", z.object({ currentPassword: z.string().max(128), newPassword: password })),
    async (c) => {
      await profileService.changePassword(c.req.raw.headers, c.req.valid("json"));
      return c.json({ ok: true });
    },
  )
  .post("/avatar", uploadRateLimit, async (c) => {
    const body = await c.req.parseBody();
    if (!(body.file instanceof File)) throw new AppError(400, "file: an image is required");
    return c.json({ image: await profileService.setAvatar(c.get("user").id, body.file) });
  })
  .delete("/avatar", async (c) => {
    await profileService.removeAvatar(c.get("user").id);
    return c.json({ ok: true });
  });

/** Avatars of users in the same Sammelband. */
export const avatarRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/:userId", (c) => profileService.serveAvatar(c.req.param("userId")));
