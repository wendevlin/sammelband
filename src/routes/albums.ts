import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as albumService from "../services/album.service";

const description = z.string().max(5000).nullable().optional();
const nullableId = z.string().nullable().optional();

export const albumRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json(await albumService.attachCovers(await albumService.listAlbums())))
  .post(
    "/",
    validate(
      "json",
      z.object({
        title: z.string().min(1).max(200),
        description,
        folderId: nullableId,
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const album = await albumService.createAlbum({
        title: body.title,
        description: body.description ?? null,
        folderId: body.folderId ?? null,
        createdBy: c.get("user").id,
      });
      return c.json(album, 201);
    },
  )
  // Takes the URL ref ("<slug>-<shortId>"); every other album route takes the UUID.
  .get("/:ref", async (c) => c.json(await albumService.getAlbumDetail(c.req.param("ref"))))
  .patch(
    "/:id",
    validate(
      "json",
      z.object({
        title: z.string().min(1).max(200).optional(),
        description,
        folderId: nullableId,
      }),
    ),
    async (c) => c.json(await albumService.updateAlbum(c.req.param("id"), c.req.valid("json"))),
  )
  .post("/:id/cover", validate("json", z.object({ photoId: z.string().nullable() })), async (c) =>
    c.json(await albumService.setCover(c.req.param("id"), c.req.valid("json").photoId)),
  )
  .delete("/:id", async (c) => {
    await albumService.deleteAlbum(c.req.param("id"));
    return c.json({ ok: true });
  });
