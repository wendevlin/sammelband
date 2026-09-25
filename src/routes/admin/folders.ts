import { t } from "elysia";
import { adminRouter } from "../../middleware/auth.middleware";
import * as folderService from "../../services/folder.service";

export const adminFoldersRoutes = adminRouter("/admin/folders")
  .get("/", () => folderService.listFolders())
  .post(
    "/",
    ({ body, user }) =>
      folderService.createFolder({
        name: body.name,
        parentId: body.parentId ?? null,
        createdBy: user.id,
      }),
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 200 }),
        parentId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )
  .patch(
    "/:id",
    ({ params, body }) =>
      folderService.updateFolder(params.id, {
        name: body.name,
        parentId: body.parentId,
      }),
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
        parentId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )
  .delete(
    "/:id",
    ({ params }) => {
      folderService.deleteFolder(params.id);
      return { ok: true };
    },
    { params: t.Object({ id: t.String() }) },
  );
