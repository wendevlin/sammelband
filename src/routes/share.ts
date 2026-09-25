import { Elysia, status, t } from "elysia";
import { config } from "../config";
import { db } from "../db/client";
import type { Album, Folder } from "../db/schema";
import { sign } from "../lib/signed-cookie";
import * as albumService from "../services/album.service";
import * as shareService from "../services/share.service";
import { getAlbumDetail } from "./user";

export const SHARE_COOKIE_NAME = "sb_share";
const SHARE_COOKIE_MAX_AGE_SEC = 4 * 60 * 60; // 4 hours per share-link session

export const shareRoutes = new Elysia().get(
  // API path is /api/share/:token; the SPA page lives at /share/:token. Keeping
  // them distinct lets a full-page load of the share link reach the SPA instead
  // of this JSON endpoint (the dev proxy / prod SPA fallback only claims /api/*).
  "/api/share/:token",
  async ({ params, headers, cookie }) => {
    // Password may arrive via header (preferred for the SPA) or query string.
    const password = headers["x-share-password"];

    const result = await shareService.validateShareAccess(
      params.token,
      password,
    );
    if (!result.valid) {
      if (
        result.reason === "password_required" ||
        result.reason === "wrong_password"
      ) {
        return status(403, {
          requiresPassword: true,
          wrongPassword: result.reason === "wrong_password",
        });
      }
      return status(404, { error: "Share link not found" });
    }

    // Set the signed share session cookie. /images/* will trust this.
    cookie[SHARE_COOKIE_NAME]!.set({
      value: sign(result.link.id),
      httpOnly: true,
      sameSite: "lax",
      secure: !config.isDev,
      path: "/",
      maxAge: SHARE_COOKIE_MAX_AGE_SEC,
    });

    if (result.link.album_id) {
      return { type: "album", ...getAlbumDetail(result.link.album_id) };
    }
    if (result.link.folder_id) {
      const folder = db
        .query("SELECT * FROM folders WHERE id = ?")
        .get(result.link.folder_id) as Folder | null;
      if (!folder) return status(404, { error: "Folder not found" });
      // Recursive descendant walk: all albums in this folder or any sub-folder.
      const albums = db
        .query(
          `
          WITH RECURSIVE descendants(id) AS (
            SELECT id FROM folders WHERE id = ?1
            UNION
            SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
          )
          SELECT a.* FROM albums a
          JOIN descendants d ON d.id = a.folder_id
          ORDER BY a.created_at DESC
          `,
        )
        .all(result.link.folder_id) as Album[];
      return {
        type: "folder",
        folder,
        albums: albumService.attachCovers(albums),
      };
    }

    // CHECK constraint should make this unreachable.
    return status(500, { error: "Share link has no resource" });
  },
  {
    params: t.Object({ token: t.String() }),
    headers: t.Object({
      "x-share-password": t.Optional(t.String()),
    }),
  },
);
