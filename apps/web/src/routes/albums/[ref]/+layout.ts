import type { AlbumDetail, Folder } from "@sammelband/shared";
import { redirect } from "@sveltejs/kit";
import { load as get } from "$lib/api";
import { albumRef } from "$lib/links";

export const load = async ({ params, url, fetch, depends, parent, untrack }) => {
  // Wait for the root layout's auth/onboarding gate before hitting the API.
  await parent();
  const [detail, folders] = await Promise.all([
    get<AlbumDetail>(`/albums/${params.ref}`, fetch),
    get<Folder[]>("/folders", fetch),
  ]);
  // Keyed by UUID so the layout's live invalidation matches whatever the URL is.
  depends(`app:album:${detail.album.id}`);
  // An outdated or missing slug goes to the canonical URL, keeping /edit etc.
  // Untracked so switching between view and edit doesn't refetch the album.
  const canonical = albumRef(detail.album);
  if (params.ref !== canonical) {
    const rest = untrack(() => url.pathname.split("/").slice(3).join("/") + url.search);
    redirect(307, `/albums/${canonical}${rest && !rest.startsWith("?") ? `/${rest}` : rest}`);
  }
  return { ...detail, folders };
};
