import { EXPORT_FORMATS, EXPORT_PURPOSES } from "@sammelband/shared";
import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as exportService from "../services/export.service";

// PDF exports: signed-in users only, never through public links.

/** Under /api/albums: an album's exports. */
export const albumExportRoutes = new Hono<AuthEnv>()
  .use("/:id/exports", requireAuth)
  .get("/:id/exports", async (c) => c.json(await exportService.listExports(c.req.param("id"))))
  .post(
    "/:id/exports",
    validate(
      "json",
      z.object({
        format: z.enum(EXPORT_FORMATS),
        purpose: z.enum(EXPORT_PURPOSES),
        captions: z.boolean(),
      }),
    ),
    async (c) =>
      c.json(
        await exportService.createExport(c.req.param("id"), c.get("user").id, c.req.valid("json")),
        201,
      ),
  );

/** Under /api/exports: one export. */
export const exportRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .patch(
    "/:id",
    validate("json", z.object({ name: z.string().trim().min(1).max(200) })),
    async (c) =>
      c.json(await exportService.renameExport(c.req.param("id"), c.req.valid("json").name)),
  )
  .delete("/:id", async (c) => {
    await exportService.deleteExport(c.req.param("id"));
    return c.json({ ok: true });
  })
  .get("/:id/file", (c) => exportService.downloadExport(c.req.param("id")));
