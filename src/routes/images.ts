import { Elysia, status, t } from "elysia";
import { auth } from "../auth";
import { db } from "../db/client";
import type { Photo, ShareLink } from "../db/schema";
import { verify as verifySignedCookie } from "../lib/signed-cookie";
import { adminRouter } from "../middleware/auth.middleware";
import * as accessService from "../services/access.service";
import * as imageService from "../services/image.service";
import { SHARE_COOKIE_NAME } from "./share";

/**
 * Variant route. Authorizes the request via either:
 *   1. A logged-in session whose accessible albums include this photo's album.
 *   2. A valid sb_share signed cookie whose share link covers this photo.
 *
 * Returns 404 (not 403) on failure to avoid leaking which filenames exist.
 */
export const variantRoutes = new Elysia().get(
  "/images/:filename",
  async ({ params, query, request, cookie }) => {
    if (query.w === undefined) {
      return status(403, {
        error: "Use /api/admin/images/:filename for originals",
      });
    }

    const photo = lookupPhotoByFilename(params.filename);
    if (!photo) return status(404, { error: "Not found" });

    const allowed = await isAuthorized({
      photo,
      headers: request.headers,
      shareCookieValue: cookie[SHARE_COOKIE_NAME]?.value,
    });
    if (!allowed) return status(404, { error: "Not found" });

    const width = Number(query.w);
    const format = query.format === "jpeg" ? "jpeg" : "webp";
    return imageService.serveVariant(params.filename, width, format);
  },
  {
    params: t.Object({ filename: t.String() }),
    query: t.Object({
      w: t.Optional(t.String()),
      format: t.Optional(t.Union([t.Literal("webp"), t.Literal("jpeg")])),
    }),
  },
);

export const adminImageRoutes = adminRouter().get(
  "/admin/images/:filename",
  ({ params }) => imageService.serveOriginal(params.filename),
  { params: t.Object({ filename: t.String() }) },
);

// ---- helpers ---------------------------------------------------------------

function lookupPhotoByFilename(
  filename: string,
): (Photo & { folder_id: string | null }) | null {
  return db
    .query(
      `SELECT p.*, a.folder_id
       FROM photos p
       JOIN image_files i ON i.id = p.image_file_id
       JOIN albums a ON a.id = p.album_id
       WHERE i.filename = ?
       LIMIT 1`,
    )
    .get(filename) as (Photo & { folder_id: string | null }) | null;
}

async function isAuthorized(args: {
  photo: Photo & { folder_id: string | null };
  headers: Headers;
  shareCookieValue: unknown;
}): Promise<boolean> {
  // Path 1: logged-in user. Admins see everything; non-admins via getAccessibleAlbums.
  const session = await auth.api.getSession({ headers: args.headers });
  const sessionUser = session?.user as
    | { id: string; role?: string }
    | undefined;
  if (sessionUser) {
    if (sessionUser.role === "admin") return true;
    if (accessService.canSeeAlbum(sessionUser.id, args.photo.album_id))
      return true;
  }

  // Path 2: share-cookie path.
  const cookieValue =
    typeof args.shareCookieValue === "string" ? args.shareCookieValue : null;
  const shareLinkId = verifySignedCookie(cookieValue);
  if (!shareLinkId) return false;

  const link = db
    .query("SELECT * FROM share_links WHERE id = ?")
    .get(shareLinkId) as ShareLink | null;
  if (!link || link.revoked_at) return false;
  if (link.expires_at && link.expires_at < Date.now()) return false;

  if (link.album_id) return link.album_id === args.photo.album_id;

  if (link.folder_id) {
    // Photo's album must be in the shared folder's subtree.
    if (!args.photo.folder_id) return false;
    const row = db
      .query(
        `
        WITH RECURSIVE chain(id, parent_id) AS (
          SELECT id, parent_id FROM folders WHERE id = ?1
          UNION ALL
          SELECT f.id, f.parent_id FROM chain c JOIN folders f ON f.id = c.parent_id
        )
        SELECT 1 AS ok FROM chain WHERE id = ?2 LIMIT 1
        `,
      )
      .get(args.photo.folder_id, link.folder_id);
    return row !== null;
  }
  return false;
}
