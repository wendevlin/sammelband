import { Hono } from "hono";
import { z } from "zod";
import { validate } from "../lib/validate";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as imageDelivery from "../services/image-delivery.service";

/**
 * GET /api/images/:filename?w=400|800|1200|1920&format=webp|jpeg
 * Without `w` the original file is served. Any signed-in user may fetch images.
 */
export const imageRoutes = new Hono<AuthEnv>().get(
  "/:filename",
  requireAuth,
  validate(
    "query",
    z.object({
      w: z.coerce.number().int().optional(),
      format: z.enum(["webp", "jpeg"]).optional(),
    }),
  ),
  (c) => {
    const filename = c.req.param("filename");
    const { w, format } = c.req.valid("query");
    if (w === undefined) return imageDelivery.serveOriginal(filename);
    return imageDelivery.serveVariant(filename, w, format ?? "webp");
  },
);
