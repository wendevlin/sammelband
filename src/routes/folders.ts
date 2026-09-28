import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as folderService from "../services/folder.service";
import { SORT_MODES } from "../services/sort.service";

const nullableId = z.string().nullable().optional();

// Sorting is per user: each user's order of the same folder is their own.
export const sortBody = z.object({ mode: z.enum(SORT_MODES) });
export const moveBody = z.object({
  kind: z.enum(["album", "folder"]),
  id: z.string(),
  /** Put the item before this one; null moves it to the end. */
  beforeId: z.string().nullable(),
});

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
  .get("/:id", async (c) =>
    c.json(await folderService.getFolderContents(c.req.param("id"), c.get("user").id)),
  )
  .put("/:id/sort", validate("json", sortBody), async (c) => {
    await folderService.setSortMode(c.req.param("id"), c.get("user").id, c.req.valid("json").mode);
    return c.json({ ok: true });
  })
  .post("/:id/order", validate("json", moveBody), async (c) =>
    c.json(await folderService.moveItem(c.req.param("id"), c.get("user").id, c.req.valid("json"))),
  )
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
