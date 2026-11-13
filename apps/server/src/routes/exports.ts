import { builtinProfileId, EXPORT_FORMATS, EXPORT_PURPOSES } from "@sammelband/shared";
import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as exportService from "../services/export.service";
import * as profileService from "../services/export-profile.service";

// PDF exports: signed-in users only, never through public links.

/** Under /api/albums: an album's exports. */
export const albumExportRoutes = new Hono<AuthEnv>()
  .use("/:id/exports", requireAuth)
  .get("/:id/exports", async (c) => c.json(await exportService.listExports(c.req.param("id"))))
  .post(
    "/:id/exports",
    validate(
      "json",
      z
        .object({
          profileId: z.string().min(1).max(100).optional(),
          // Before print profiles: a page format and purpose (a built-in profile).
          format: z.enum(EXPORT_FORMATS).optional(),
          purpose: z.enum(EXPORT_PURPOSES).optional(),
          captions: z.boolean(),
          albumLink: z.boolean().optional(),
        })
        .refine((x) => x.profileId || (x.format && x.purpose), {
          message: "profileId is required",
        }),
    ),
    async (c) => {
      const { profileId, format, purpose, captions, albumLink } = c.req.valid("json");
      const id = profileId ?? builtinProfileId(purpose ?? "print", format ?? "a4");
      return c.json(
        await exportService.createExport(c.req.param("id"), c.get("user").id, {
          profileId: id,
          captions,
          albumLink,
        }),
        201,
      );
    },
  );

/** Under /api/export-profiles: the print profiles exports can be made with. */
export const exportProfileRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json(await profileService.usableProfiles()));

/** Under /api/exports: one export. */
export const exportRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .patch(
    "/:id",
    validate("json", z.object({ name: z.string().trim().min(1).max(200) })),
    async (c) =>
      c.json(await exportService.renameExport(c.req.param("id"), c.req.valid("json").name)),
  )
  // ?keepLinks=true keeps the links its QR codes lead to.
  .delete(
    "/:id",
    validate("query", z.object({ keepLinks: z.enum(["true", "false"]).optional() })),
    async (c) => {
      const keep = c.req.valid("query").keepLinks === "true";
      await exportService.deleteExport(c.req.param("id"), keep);
      return c.json({ ok: true });
    },
  )
  // ?part=cover: the separate cover of profiles that have one.
  .get(
    "/:id/file",
    validate("query", z.object({ part: z.enum(["book", "cover"]).optional() })),
    (c) => exportService.downloadExport(c.req.param("id"), c.req.valid("query").part),
  );
