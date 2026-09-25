import { t } from "elysia";
import { adminRouter } from "../../middleware/auth.middleware";
import * as shareService from "../../services/share.service";

const createBody = t.Object({
  password: t.Optional(t.String({ minLength: 4 })),
  expiresAt: t.Optional(t.Union([t.Number(), t.Null()])),
});

export const adminSharesRoutes = adminRouter()
  // Albums
  .get(
    "/admin/albums/:id/share",
    ({ params }) => shareService.listShareLinks({ albumId: params.id }).map(shareService.redact),
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/admin/albums/:id/share",
    async ({ params, body, user }) => {
      const link = await shareService.createShareLink({
        albumId: params.id,
        createdBy: user.id,
        password: body.password,
        expiresAt: body.expiresAt ?? null,
      });
      return shareService.redact(link);
    },
    { params: t.Object({ id: t.String() }), body: createBody },
  )
  .delete(
    "/admin/albums/:id/share/:token",
    ({ params }) => {
      shareService.revokeShareLink(params.token);
      return { ok: true };
    },
    { params: t.Object({ id: t.String(), token: t.String() }) },
  )
  // Folders
  .get(
    "/admin/folders/:id/share",
    ({ params }) => shareService.listShareLinks({ folderId: params.id }).map(shareService.redact),
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/admin/folders/:id/share",
    async ({ params, body, user }) => {
      const link = await shareService.createShareLink({
        folderId: params.id,
        createdBy: user.id,
        password: body.password,
        expiresAt: body.expiresAt ?? null,
      });
      return shareService.redact(link);
    },
    { params: t.Object({ id: t.String() }), body: createBody },
  )
  .delete(
    "/admin/folders/:id/share/:token",
    ({ params }) => {
      shareService.revokeShareLink(params.token);
      return { ok: true };
    },
    { params: t.Object({ id: t.String(), token: t.String() }) },
  );
