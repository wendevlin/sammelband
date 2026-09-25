import { status, t } from "elysia";
import { db } from "../db/client";
import type { Album, AlbumBlock, Photo } from "../db/schema";
import { AppError } from "../lib/errors";
import { userRouter } from "../middleware/auth.middleware";
import * as accessService from "../services/access.service";
import * as albumService from "../services/album.service";

export const userRoutes = userRouter()
  .get("/folders", ({ user }) =>
    user.role === "admin"
      ? accessService.getAllFolders()
      : accessService.getVisibleFolderTree(user.id),
  )
  .get(
    "/folders/:id",
    ({ params, user }) => {
      // Admins see every folder; regular users need a grant (direct or inherited).
      let contents: { folders: unknown[]; albums: Album[] } | null;
      if (user.role === "admin") {
        if (!accessService.folderExists(params.id))
          return status(404, { error: "Folder not found" });
        contents = accessService.listFolderContents(params.id);
      } else {
        contents = accessService.getFolderContents(user.id, params.id);
        if (!contents) return status(404, { error: "Folder not found" });
      }
      return { ...contents, albums: albumService.attachCovers(contents.albums) };
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get("/albums", ({ user }) =>
    albumService.attachCovers(
      user.role === "admin"
        ? accessService.getAllAlbums()
        : accessService.getAccessibleAlbums(user.id),
    ),
  )
  .get(
    "/albums/:id",
    ({ params, user }) => {
      // Admins can see every album; regular users need a grant (direct or inherited).
      if (user.role !== "admin" && !accessService.canSeeAlbum(user.id, params.id))
        return status(404, { error: "Album not found" });
      return getAlbumDetail(params.id);
    },
    { params: t.Object({ id: t.String() }) },
  );

/**
 * Album + ordered blocks + photos (with image metadata + placeholder).
 * Used by both the logged-in user view and the public share-token view.
 */
export function getAlbumDetail(albumId: string) {
  const album = db.query("SELECT * FROM albums WHERE id = ?").get(albumId);
  if (!album) throw new AppError(404, "Album not found");
  const blocks = db
    .query("SELECT * FROM album_blocks WHERE album_id = ? ORDER BY sort_order ASC")
    .all(albumId) as AlbumBlock[];
  const photos = db
    .query(
      `SELECT p.*, i.filename, i.width, i.height, i.placeholder
       FROM photos p JOIN image_files i ON i.id = p.image_file_id
       WHERE p.album_id = ?
       ORDER BY p.uploaded_at`,
    )
    .all(albumId) as (Photo & {
    filename: string;
    width: number;
    height: number;
    placeholder: string;
  })[];
  return { album, blocks, photos };
}
