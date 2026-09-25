import { t } from "elysia";
import { adminRouter } from "../../middleware/auth.middleware";
import * as blockService from "../../services/block.service";

export const adminBlocksRoutes = adminRouter()
  .get("/admin/albums/:id/blocks", ({ params }) => blockService.listBlocks(params.id), {
    params: t.Object({ id: t.String() }),
  })
  .post(
    "/admin/albums/:id/blocks",
    ({ params, body }) =>
      blockService.createBlock({
        albumId: params.id,
        type: body.type,
        content: body.content,
        parentId: body.parentId ?? null,
        position: body.afterId ? { afterId: body.afterId } : undefined,
      }),
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        type: t.Union([
          t.Literal("heading"),
          t.Literal("text"),
          t.Literal("gallery"),
          t.Literal("group"),
        ]),
        content: t.Any(),
        parentId: t.Optional(t.Union([t.String(), t.Null()])),
        afterId: t.Optional(t.String()),
      }),
    },
  )
  .patch(
    "/admin/albums/:id/blocks/:blockId",
    ({ params, body }) =>
      blockService.updateBlock(params.blockId, {
        type: body.type,
        content: body.content,
        parentId: body.parentId,
      }),
    {
      params: t.Object({ id: t.String(), blockId: t.String() }),
      body: t.Object({
        type: t.Optional(
          t.Union([
            t.Literal("heading"),
            t.Literal("text"),
            t.Literal("gallery"),
            t.Literal("group"),
          ]),
        ),
        content: t.Optional(t.Any()),
        parentId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )
  .delete(
    "/admin/albums/:id/blocks/:blockId",
    ({ params }) => {
      blockService.deleteBlock(params.blockId);
      return { ok: true };
    },
    { params: t.Object({ id: t.String(), blockId: t.String() }) },
  )
  .post(
    "/admin/albums/:id/blocks/reorder",
    ({ params, body }) => {
      blockService.reorderBlocks(params.id, body.order);
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        order: t.Array(t.Object({ id: t.String(), sortOrder: t.Number() })),
      }),
    },
  );
