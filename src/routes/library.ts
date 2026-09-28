import { Hono } from "hono";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as folderService from "../services/folder.service";
import { moveBody, sortBody } from "./folders";

/** The top level of the library: root folders as tiles and albums outside any folder. */
export const libraryRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", async (c) => c.json(await folderService.getLibrary(c.get("user").id)))
  .put("/sort", validate("json", sortBody), async (c) => {
    await folderService.setSortMode(null, c.get("user").id, c.req.valid("json").mode);
    return c.json({ ok: true });
  })
  .post("/order", validate("json", moveBody), async (c) =>
    c.json(await folderService.moveItem(null, c.get("user").id, c.req.valid("json"))),
  );
