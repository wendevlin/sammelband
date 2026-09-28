import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as folderService from "../services/folder.service";

const nullableId = z.string().nullable().optional();

export const folderRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json(await folderService.listFolders()))
  .post(
    "/",
    validate("json", z.object({ name: z.string().min(1).max(200), parentId: nullableId })),
    async (c) => {
      const body = c.req.valid("json");
      const folder = await folderService.createFolder({
        name: body.name,
        parentId: body.parentId ?? null,
        createdBy: c.get("user").id,
      });
      return c.json(folder, 201);
    },
  )
  .get("/:id", async (c) => c.json(await folderService.getFolderContents(c.req.param("id"))))
  .patch(
    "/:id",
    validate(
      "json",
      z.object({ name: z.string().min(1).max(200).optional(), parentId: nullableId }),
    ),
    async (c) => c.json(await folderService.updateFolder(c.req.param("id"), c.req.valid("json"))),
  )
  .delete("/:id", async (c) => {
    await folderService.deleteFolder(c.req.param("id"));
    return c.json({ ok: true });
  });

/** The top level of the library: root folders as tiles and albums outside any folder. */
export const libraryRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json(await folderService.getLibrary()));
