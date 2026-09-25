import { t } from "elysia";
import { adminRouter } from "../../middleware/auth.middleware";
import * as albumService from "../../services/album.service";

export const adminAlbumsRoutes = adminRouter("/admin/albums")
  .get("/", () => albumService.attachCovers(albumService.listAlbums()))
  .post(
    "/",
    ({ body, user }) =>
      albumService.createAlbum({
        title: body.title,
        description: body.description ?? null,
        folderId: body.folderId ?? null,
        shareable: body.shareable ?? false,
        createdBy: user.id,
      }),
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 200 }),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        folderId: t.Optional(t.Union([t.String(), t.Null()])),
        shareable: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    "/:id",
    ({ params, body }) =>
      albumService.updateAlbum(params.id, {
        title: body.title,
        description: body.description,
        folderId: body.folderId,
        shareable: body.shareable,
      }),
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        folderId: t.Optional(t.Union([t.String(), t.Null()])),
        shareable: t.Optional(t.Boolean()),
      }),
    },
  )
  .post("/:id/cover", ({ params, body }) => albumService.setCover(params.id, body.photoId), {
    params: t.Object({ id: t.String() }),
    body: t.Object({ photoId: t.Union([t.String(), t.Null()]) }),
  })
  .delete(
    "/:id",
    ({ params }) => {
      albumService.deleteAlbum(params.id);
      return { ok: true };
    },
    { params: t.Object({ id: t.String() }) },
  );
