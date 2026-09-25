import { t } from "elysia";
import { adminRouter } from "../../middleware/auth.middleware";
import * as grantService from "../../services/grant.service";

export const adminGrantsRoutes = adminRouter()
  // Albums
  .get("/admin/albums/:id/access", ({ params }) => grantService.listAlbumGrants(params.id), {
    params: t.Object({ id: t.String() }),
  })
  .post(
    "/admin/albums/:id/access",
    ({ params, body, user }) => {
      grantService.grantAlbumAccess(params.id, body.userId, user.id);
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ userId: t.String() }),
    },
  )
  .delete(
    "/admin/albums/:id/access/:userId",
    ({ params }) => {
      grantService.revokeAlbumAccess(params.id, params.userId);
      return { ok: true };
    },
    { params: t.Object({ id: t.String(), userId: t.String() }) },
  )
  // Folders
  .get("/admin/folders/:id/access", ({ params }) => grantService.listFolderGrants(params.id), {
    params: t.Object({ id: t.String() }),
  })
  .post(
    "/admin/folders/:id/access",
    ({ params, body, user }) => {
      grantService.grantFolderAccess(params.id, body.userId, user.id);
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ userId: t.String() }),
    },
  )
  .delete(
    "/admin/folders/:id/access/:userId",
    ({ params }) => {
      grantService.revokeFolderAccess(params.id, params.userId);
      return { ok: true };
    },
    { params: t.Object({ id: t.String(), userId: t.String() }) },
  );
