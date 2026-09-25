import { t } from "elysia";
import { adminRouter } from "../../middleware/auth.middleware";
import { uploadRateLimit } from "../../middleware/rate-limit.middleware";
import * as imageService from "../../services/image.service";

export const adminPhotosRoutes = adminRouter()
  .use(uploadRateLimit)
  .post(
    // Photos are uploaded directly into a gallery block (galleries own them).
    "/admin/blocks/:blockId/photos",
    async ({ params, body, user }) => {
      const files = Array.isArray(body.files) ? body.files : [body.files];
      const results = await Promise.all(
        files.map((f) => imageService.uploadPhoto(f, params.blockId, user.id)),
      );
      return { uploaded: results };
    },
    {
      params: t.Object({ blockId: t.String() }),
      body: t.Object({ files: t.Union([t.File(), t.Files()]) }),
    },
  )
  .post(
    "/admin/blocks/:blockId/photos/reorder",
    ({ params, body }) => {
      imageService.reorderPhotos(params.blockId, body.order);
      return { ok: true };
    },
    {
      params: t.Object({ blockId: t.String() }),
      body: t.Object({
        order: t.Array(t.Object({ id: t.String(), sortOrder: t.Number() })),
      }),
    },
  )
  .patch(
    "/admin/photos/:photoId",
    ({ params, body }) => imageService.updateCaption(params.photoId, body.caption),
    {
      params: t.Object({ photoId: t.String() }),
      body: t.Object({ caption: t.Union([t.String(), t.Null()]) }),
    },
  )
  .delete(
    "/admin/photos/:photoId",
    ({ params }) => {
      imageService.deletePhoto(params.photoId);
      return { ok: true };
    },
    { params: t.Object({ photoId: t.String() }) },
  );
