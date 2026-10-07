<script lang="ts">
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import FileDown from "@lucide/svelte/icons/file-down";
import Files from "@lucide/svelte/icons/files";
import Pencil from "@lucide/svelte/icons/pencil";
import type { Folder } from "@sammelband/shared";
import { AlbumExports } from "$lib/album-exports.svelte";
import { getAlbumState } from "$lib/album-state.svelte";
import AlbumContent from "$lib/components/album/album-content.svelte";
import ExportDialog from "$lib/components/export/export-dialog.svelte";
import ExportsDialog from "$lib/components/export/exports-dialog.svelte";
import ShareButton from "$lib/components/share/share-button.svelte";
import * as Breadcrumb from "$lib/components/ui/breadcrumb";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { albumPath } from "$lib/links";
import { m } from "$lib/paraglide/messages.js";
import { auth } from "$lib/stores/auth.svelte";

let { data } = $props();

// Album, sections and photos come from the layout's live state; `data` still
// carries the folders.
const live = getAlbumState();

// PDF export: when the admins allow it. Existing exports stay reachable either way.
const exports = new AlbumExports(() => live.album.id);
const canExport = $derived(auth.tenant?.pdf_export_enabled ?? false);
let exportOpen = $state(false);
let exportsOpen = $state(false);

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
  <!-- As wide as the sections below, so title and photos share the left edge. -->
  <div class="bleed mb-10 flex flex-wrap items-start justify-between gap-4">
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
      {#if canExport || exports.list.length > 0}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="outline" size="icon" aria-label={m.album_more()}>
                <Ellipsis />
              </Button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end">
            {#if canExport}
              <DropdownMenu.Item onclick={() => (exportOpen = true)}>
                <FileDown />
                {m.export_pdf()}
              </DropdownMenu.Item>
            {/if}
            {#if exports.list.length > 0}
              <DropdownMenu.Item onclick={() => (exportsOpen = true)}>
                <Files />
                {m.exports_count({ count: exports.list.length })}
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>
  </div>
  <AlbumContent sections={live.sections} photos={live.photos} />
</article>

<ExportDialog
  bind:open={exportOpen}
  albumId={live.album.id}
  {exports}
  onshowall={() => (exportsOpen = true)}
/>
<ExportsDialog bind:open={exportsOpen} {exports} />
