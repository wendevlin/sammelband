<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import type { Folder } from "@sammelband/shared";
import { getAlbumState } from "$lib/album-state.svelte";
import AlbumContent from "$lib/components/album/album-content.svelte";
import ShareButton from "$lib/components/share/share-button.svelte";
import * as Breadcrumb from "$lib/components/ui/breadcrumb";
import { Button } from "$lib/components/ui/button";
import { albumPath } from "$lib/links";
import { m } from "$lib/paraglide/messages.js";

let { data } = $props();

// Album, blocks and photos come from the layout's live state; `data` still
// carries the folders.
const live = getAlbumState();

const trail = $derived.by(() => {
  const chain: Folder[] = [];
  let current = data.folders.find((f) => f.id === live.album.folder_id) ?? null;
  while (current) {
    chain.unshift(current);
    const parentId: string | null = current.parent_id;
    current = data.folders.find((f) => f.id === parentId) ?? null;
  }
  return chain;
});
</script>

<svelte:head><title>{live.album.title} · Sammelband</title></svelte:head>

<article class="mx-auto max-w-4xl">
  <div class="mb-10 flex flex-wrap items-start justify-between gap-4">
    <!-- min-w-0: long titles wrap instead of widening the page. -->
    <div class="min-w-0">
      <Breadcrumb.Root class="mb-3">
        <Breadcrumb.List>
          <Breadcrumb.Item
            ><Breadcrumb.Link href="/">{m.nav_library()}</Breadcrumb.Link></Breadcrumb.Item
          >
          {#each trail as f (f.id)}
            <Breadcrumb.Separator />
            <Breadcrumb.Item>
              <Breadcrumb.Link href="/folders/{f.id}">{f.name}</Breadcrumb.Link>
            </Breadcrumb.Item>
          {/each}
        </Breadcrumb.List>
      </Breadcrumb.Root>
      <h1 class="font-heading text-4xl leading-tight sm:text-5xl">{live.album.title}</h1>
      {#if live.album.description}
        <p class="mt-4 max-w-2xl text-lg text-muted-foreground">{live.album.description}</p>
      {/if}
    </div>
    <div class="flex gap-2">
      <ShareButton target={{ albumId: live.album.id }} name={live.album.title} />
      <Button variant="outline" href={albumPath(live.album, "/edit")}
        ><Pencil /> {m.album_edit()}</Button
      >
    </div>
  </div>
  <AlbumContent blocks={live.blocks} photos={live.photos} />
</article>
