import { Hono } from "hono";
import { z } from "zod";
import { fail } from "../lib/errors";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as sectionService from "../services/section.service";

const fields = z.object({
  title: z.string().max(500).optional(),
  text: z
    .string()
    .max(64 * 1024)
    .optional(),
  highlight: z.boolean().optional(),
});
const order = z.object({
  order: z.array(z.object({ id: z.string(), sortOrder: z.number() })),
});

/** Mounted under /api/albums: sections live at /api/albums/:id/sections. */
export const sectionRoutes = new Hono<AuthEnv>()
  .use("/:id/sections/*", requireAuth)
  .use("/:id/sections", requireAuth)
  .get("/:id/sections", async (c) => c.json(await sectionService.listSections(c.req.param("id"))))
  .post(
    "/:id/sections",
    validate("json", fields.extend({ beforeId: z.string().optional() })),
    async (c) => {
      const { beforeId, ...body } = c.req.valid("json");
      const section = await sectionService.createSection({
        albumId: c.req.param("id"),
        fields: body,
        beforeId,
      });
      return c.json(section, 201);
    },
  )
  .post("/:id/sections/reorder", validate("json", order), async (c) => {
    await sectionService.reorderSections(c.req.param("id"), c.req.valid("json").order);
    return c.json({ ok: true });
  })
  .patch("/:id/sections/:sectionId", validate("json", fields), async (c) => {
    await ensureInAlbum(c.req.param("id"), c.req.param("sectionId"));
    return c.json(
      await sectionService.updateSection(c.req.param("sectionId"), c.req.valid("json")),
    );
  })
  .delete("/:id/sections/:sectionId", async (c) => {
    await ensureInAlbum(c.req.param("id"), c.req.param("sectionId"));
    await sectionService.deleteSection(c.req.param("sectionId"));
    return c.json({ ok: true });
  });

async function ensureInAlbum(albumId: string, sectionId: string): Promise<void> {
  const section = await sectionService.getSection(sectionId);
  if (!section || section.album_id !== albumId) throw fail("section_not_found");
}
