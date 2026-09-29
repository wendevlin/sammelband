import type { Album } from "@sammelband/shared";

type AlbumLinkFields = Pick<Album, "slug" | "short_id">;

/** URL segment for an album: "<slug>-<shortId>". Only the shortId is used for lookup. */
export const albumRef = (a: AlbumLinkFields): string => `${a.slug}-${a.short_id}`;

/** In-app path of an album, e.g. albumPath(a, "/edit"). */
export const albumPath = (a: AlbumLinkFields, suffix = ""): string =>
  `/albums/${albumRef(a)}${suffix}`;
