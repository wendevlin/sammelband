import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { config } from "../config";
import { validate } from "../lib/validate";
import { rateLimit } from "../middleware/rate-limit.middleware";
import * as publicService from "../services/public.service";

// Public links, no account needed. Rate limits are per IP: generous for
// browsing, strict for password guesses, and a cap on mass image downloads.
const viewLimit = rateLimit({ name: "public-view", windowMs: 10 * 60 * 1000, max: 300 });
const unlockLimit = rateLimit({ name: "public-unlock", windowMs: 10 * 60 * 1000, max: 10 });
const imageLimit = rateLimit({ name: "public-image", windowMs: 10 * 60 * 1000, max: 3000 });
// Wrong passwords per link, from all IPs together: bounds guessing spread over
// many addresses. Right ones don't count, so a link shared widely keeps working.
const unlockLinkLimit = rateLimit({
  name: "public-unlock-link",
  windowMs: 60 * 60 * 1000,
  max: 50,
  failuresOnly: true,
  // Real tokens are 32 characters; longer ones only fill the bucket map.
  key: (c) => (c.req.param("token") ?? "").slice(0, 64),
});

export const publicRoutes = new Hono()
  .get(
    "/:token",
    viewLimit,
    validate("query", z.object({ album: z.string().optional(), folder: z.string().optional() })),
    async (c) => {
      const token = c.req.param("token");
      const access = await publicService.access(token, (name) => getCookie(c, name));
      const { album, folder } = c.req.valid("query");
      c.header("Cache-Control", "no-store");
      return c.json(await publicService.view(access, { albumRef: album, folderId: folder }));
    },
  )
  .post(
    "/:token/unlock",
    unlockLimit,
    unlockLinkLimit,
    validate("json", z.object({ password: z.string().max(128) })),
    async (c) => {
      const token = c.req.param("token");
      const cookie = await publicService.unlock(token, c.req.valid("json").password);
      setCookie(c, cookie.name, cookie.value, {
        path: `/api/public/${token}`,
        httpOnly: true,
        sameSite: "Lax",
        secure: !config.isDev,
        maxAge: cookie.maxAge,
      });
      return c.json({ ok: true });
    },
  )
  .get(
    "/:token/images/:filename",
    imageLimit,
    // Resized versions only: a public link never hands out originals.
    validate(
      "query",
      z.object({ w: z.coerce.number().int(), format: z.enum(["webp", "jpeg"]).optional() }),
    ),
    async (c) => {
      const access = await publicService.access(c.req.param("token"), (name) => getCookie(c, name));
      const { w, format } = c.req.valid("query");
      return publicService.image(access, c.req.param("filename"), w, format ?? "webp");
    },
  );
