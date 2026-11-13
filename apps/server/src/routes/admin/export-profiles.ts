import { EXPORT_PURPOSES } from "@sammelband/shared";
import { Hono } from "hono";
import { z } from "zod";
import { exportProfileSpecSchema, profileNameSchema } from "../../lib/export-profile-schema";
import { validate } from "../../lib/validate";
import { type AuthEnv, requireAdmin } from "../../middleware/auth.middleware";
import * as profileService from "../../services/export-profile.service";

/** Print profiles of the admin's Sammelband: own ones, and which are switched on. */
export const adminExportProfileRoutes = new Hono<AuthEnv>()
  .use("*", requireAdmin)
  .get("/", async (c) => c.json(await profileService.listProfiles()))
  .post(
    "/",
    validate("json", z.object({ name: profileNameSchema, spec: exportProfileSpecSchema })),
    async (c) => c.json(await profileService.createProfile(c.req.valid("json")), 201),
  )
  .put(
    "/purposes/:purpose/enabled",
    validate("param", z.object({ purpose: z.enum(EXPORT_PURPOSES) })),
    validate("json", z.object({ enabled: z.boolean() })),
    async (c) => {
      await profileService.setPurposeEnabled(
        c.req.valid("param").purpose,
        c.req.valid("json").enabled,
      );
      return c.json({ ok: true });
    },
  )
  .patch(
    "/:id",
    validate(
      "json",
      z.object({ name: profileNameSchema.optional(), spec: exportProfileSpecSchema.optional() }),
    ),
    async (c) => c.json(await profileService.updateProfile(c.req.param("id"), c.req.valid("json"))),
  )
  .put("/:id/enabled", validate("json", z.object({ enabled: z.boolean() })), async (c) => {
    await profileService.setEnabled(c.req.param("id"), c.req.valid("json").enabled);
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    await profileService.deleteProfile(c.req.param("id"));
    return c.json({ ok: true });
  });
