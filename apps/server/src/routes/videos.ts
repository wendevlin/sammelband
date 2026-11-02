import { Hono } from "hono";
import { type AuthEnv, requireAuth } from "../middleware/auth.middleware";
import * as videoService from "../services/video.service";

/** GET /api/videos/:filename: a converted video, in parts (Range) for the player. */
export const videoRoutes = new Hono<AuthEnv>().get("/:filename", requireAuth, (c) =>
  videoService.serveVideo(c.req.param("filename"), c.req.header("range")),
);
