import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as albumService from "../services/album.service";
import * as folderService from "../services/folder.service";

const nullableId = z.string().nullable().optional();

export const folderRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", (c) => c.json(folderService.listFolders()))
  .post(
    "/",
    validate("json", z.object({ name: z.string().min(1).max(200), parentId: nullableId })),
    (c) => {
      const body = c.req.valid("json");
      const folder = folderService.createFolder({
        name: body.name,
        parentId: body.parentId ?? null,
        createdBy: c.get("user").id,
      });
      return c.json(folder, 201);
    },
  )
  .get("/:id", (c) => {
    const contents = folderService.getFolderContents(c.req.param("id"));
    return c.json({ ...contents, albums: albumService.attachCovers(contents.albums) });
  })
  .patch(
    "/:id",
    validate(
      "json",
      z.object({ name: z.string().min(1).max(200).optional(), parentId: nullableId }),
    ),
    (c) => c.json(folderService.updateFolder(c.req.param("id"), c.req.valid("json"))),
  )
  .delete("/:id", (c) => {
    folderService.deleteFolder(c.req.param("id"));
    return c.json({ ok: true });
  });
