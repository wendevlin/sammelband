<script lang="ts">
import type { AlbumPatch } from "@sammelband/shared";
import { goto, invalidate } from "$app/navigation";
import { page } from "$app/state";
import { AlbumState, setAlbumState } from "$lib/album-state.svelte";
import { albumRef } from "$lib/links";
import { live } from "$lib/live.svelte";
import { onReconnect, subscribeAll } from "$lib/ws";

let { data, children } = $props();

// Album content is patched in place from the change events (no refetch, no
// flicker). A full reload only happens on navigation, after a dropped
// connection, or when the album is deleted (the load then shows the 404).
// svelte-ignore state_referenced_locally
const album = setAlbumState(new AlbumState(data));
$effect.pre(() => album.reset(data));

$effect(() => {
  const key = `app:album:${data.album.id}`;
  const off = subscribeAll([`album:${data.album.id}`], (e) => {
    if (e.kind === "updated" && e.data) album.apply(e.data as AlbumPatch);
    else void invalidate(key);
  });
  const offReconnect = onReconnect(() => void invalidate(key));
  return () => {
    off();
    offReconnect();
  };
});

// After a rename (here or in another browser) follow the new canonical URL
// without adding a history entry.
$effect(() => {
  const canonical = albumRef(album.album);
  const ref = page.params.ref;
  if (!ref || ref === canonical) return;
  const url = new URL(page.url);
  url.pathname = url.pathname.replace(`/albums/${ref}`, `/albums/${canonical}`);
  void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
});

// Folder names and paths (breadcrumbs, the folder picker) change rarely.
live(
  () => ["folder-tree"],
  () => `app:album:${data.album.id}`,
);
</script>

{@render children()}
