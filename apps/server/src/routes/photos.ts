import { Hono } from "hono";
import { z } from "zod";
import { fail } from "../lib/errors";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import { uploadRateLimit } from "../middleware/rate-limit.middleware";
import * as imageService from "../services/image.service";

/** Mounted under /api/sections: photos are uploaded straight into a section. */
export const sectionPhotoRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .post("/:sectionId/photos", uploadRateLimit, async (c) => {
    const body = await c.req.parseBody({ all: true });
    const raw = body.files;
    const files = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter(
      (f): f is File => f instanceof File,
    );
    if (files.length === 0) throw fail("no_files");
    const uploaded = [];
    // Sequential so sort_order follows the selection order.
    for (const f of files) {
      uploaded.push(await imageService.uploadPhoto(f, c.req.param("sectionId"), c.get("user").id));
    }
    return c.json({ uploaded }, 201);
  })
  .post(
    "/:sectionId/photos/reorder",
    validate(
      "json",
      z.object({ order: z.array(z.object({ id: z.string(), sortOrder: z.number() })) }),
    ),
    async (c) => {
      await imageService.reorderPhotos(c.req.param("sectionId"), c.req.valid("json").order);
      return c.json({ ok: true });
    },
  );

/** Mounted under /api/photos. */
export const photoRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .patch(
    "/:photoId",
    validate("json", z.object({ caption: z.string().max(2000).nullable() })),
    async (c) =>
      c.json(await imageService.updateCaption(c.req.param("photoId"), c.req.valid("json").caption)),
  )
  .post(
    "/:photoId/move",
    validate("json", z.object({ sectionId: z.string(), beforeId: z.string().nullable() })),
    async (c) => {
      const { sectionId, beforeId } = c.req.valid("json");
      return c.json(await imageService.movePhoto(c.req.param("photoId"), sectionId, beforeId));
    },
  )
  .delete("/:photoId", async (c) => {
    await imageService.deletePhoto(c.req.param("photoId"));
    return c.json({ ok: true });
  });
