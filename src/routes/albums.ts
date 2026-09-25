import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as albumService from "../services/album.service";

const nullableString = z.string().nullable().optional();

export const albumRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", (c) => c.json(albumService.attachCovers(albumService.listAlbums())))
  .post(
    "/",
    validate(
      "json",
      z.object({
        title: z.string().min(1).max(200),
        description: nullableString,
        folderId: nullableString,
      }),
    ),
    (c) => {
      const body = c.req.valid("json");
      const album = albumService.createAlbum({
        title: body.title,
        description: body.description ?? null,
        folderId: body.folderId ?? null,
        createdBy: c.get("user").id,
      });
      return c.json(album, 201);
    },
  )
  .get("/:id", (c) => c.json(albumService.getAlbumDetail(c.req.param("id"))))
  .patch(
    "/:id",
    validate(
      "json",
      z.object({
        title: z.string().min(1).max(200).optional(),
        description: nullableString,
        folderId: nullableString,
      }),
    ),
    (c) => c.json(albumService.updateAlbum(c.req.param("id"), c.req.valid("json"))),
  )
  .post("/:id/cover", validate("json", z.object({ photoId: z.string().nullable() })), (c) =>
    c.json(albumService.setCover(c.req.param("id"), c.req.valid("json").photoId)),
  )
  .delete("/:id", (c) => {
    albumService.deleteAlbum(c.req.param("id"));
    return c.json({ ok: true });
  });
