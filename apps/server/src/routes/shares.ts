import { Hono } from "hono";
import { z } from "zod";
import { fail } from "../lib/errors";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as shareService from "../services/share.service";

const target = z.object({ albumId: z.string().optional(), folderId: z.string().optional() });

function toTarget(t: z.infer<typeof target>): shareService.ShareTarget {
  if (t.albumId && !t.folderId) return { albumId: t.albumId };
  if (t.folderId && !t.albumId) return { folderId: t.folderId };
  throw fail("share_target_required");
}

/** Public links of an album or folder. Everyone in the Sammelband may manage them. */
export const shareRoutes = new Hono<AuthEnv>()
  .use("*", requireAuth)
  .get("/", validate("query", target), async (c) =>
    c.json(await shareService.listShares(toTarget(c.req.valid("query")))),
  )
  .post(
    "/",
    validate(
      "json",
      target.extend({
        password: z.string().max(128).nullable().optional(),
        expiresOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
          .nullable()
          .optional(),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json");
      const link = await shareService.createShare(toTarget(body), body, c.get("user").id);
      return c.json(link, 201);
    },
  )
  .delete("/:id", async (c) => {
    await shareService.deleteShare(c.req.param("id"));
    return c.json({ ok: true });
  });
