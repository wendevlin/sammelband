import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../lib/errors";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as blockService from "../services/block.service";

const blockType = z.enum(["heading", "text", "gallery", "group"]);
/** Block content is free-form JSON; cap its size (text blocks are the big ones). */
const MAX_CONTENT_BYTES = 64 * 1024;
const content = z
  .unknown()
  .refine((v) => JSON.stringify(v ?? {}).length <= MAX_CONTENT_BYTES, "Block content is too large");
const order = z.object({
  order: z.array(z.object({ id: z.string(), sortOrder: z.number() })),
});

/** Mounted under /api/albums: blocks live at /api/albums/:id/blocks. */
export const blockRoutes = new Hono<AuthEnv>()
  .use("/:id/blocks/*", requireAuth)
  .use("/:id/blocks", requireAuth)
  .get("/:id/blocks", async (c) => c.json(await blockService.listBlocks(c.req.param("id"))))
  .post(
    "/:id/blocks",
    validate(
      "json",
      z.object({
        type: blockType,
        content,
        parentId: z.string().nullable().optional(),
        afterId: z.string().optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const block = await blockService.createBlock({
        albumId: c.req.param("id"),
        type: body.type,
        content: body.content ?? {},
        parentId: body.parentId ?? null,
        position: body.afterId ? { afterId: body.afterId } : undefined,
      });
      return c.json(block, 201);
    },
  )
  .post("/:id/blocks/reorder", validate("json", order), async (c) => {
    await blockService.reorderBlocks(c.req.param("id"), c.req.valid("json").order);
    return c.json({ ok: true });
  })
  .patch(
    "/:id/blocks/:blockId",
    validate(
      "json",
      z.object({
        type: blockType.optional(),
        content: content.optional(),
        parentId: z.string().nullable().optional(),
      }),
    ),
    async (c) => {
      await ensureInAlbum(c.req.param("id"), c.req.param("blockId"));
      return c.json(await blockService.updateBlock(c.req.param("blockId"), c.req.valid("json")));
    },
  )
  .delete("/:id/blocks/:blockId", async (c) => {
    await ensureInAlbum(c.req.param("id"), c.req.param("blockId"));
    await blockService.deleteBlock(c.req.param("blockId"));
    return c.json({ ok: true });
  });

async function ensureInAlbum(albumId: string, blockId: string): Promise<void> {
  const block = await blockService.getBlock(blockId);
  if (!block || block.album_id !== albumId) throw new AppError(404, "Block not found");
}
