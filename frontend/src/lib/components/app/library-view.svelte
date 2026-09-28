<script lang="ts">
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Plus from "@lucide/svelte/icons/plus";
import { goto } from "$app/navigation";
import { del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import * as Breadcrumb from "$lib/components/ui/breadcrumb";
import { Button } from "$lib/components/ui/button";
import { albumPath } from "$lib/links";
import type { Album, Folder, FolderTile } from "$lib/types";
import AlbumCard from "./album-card.svelte";
import ConfirmDialog from "./confirm-dialog.svelte";
import FolderCard from "./folder-card.svelte";
import PromptDialog from "./prompt-dialog.svelte";

/** Contents of one folder (or the root when `folder` is null). */
let {
  folder,
  folders,
  albums,
  allFolders,
}: {
  folder: Folder | null;
  folders: FolderTile[];
  albums: Album[];
  allFolders: Folder[];
} = $props();

const trail = $derived.by(() => {
  const chain: Folder[] = [];
  let current = folder;
  while (current) {
    chain.unshift(current);
    current = allFolders.find((f) => f.id === current?.parent_id) ?? null;
  }
  return chain;
});

let newFolderOpen = $state(false);
let newAlbumOpen = $state(false);
let renameTarget = $state<Folder | null>(null);
let renameOpen = $state(false);
let deleteTarget = $state<Folder | null>(null);
let deleteOpen = $state(false);

const createFolder = (name: string) =>
  attempt(() => post("/folders", { name, parentId: folder?.id ?? null })).then(Boolean);

async function createAlbum(title: string) {
  const album = await attempt(() =>
    post<Album>("/albums", { title, folderId: folder?.id ?? null }),
  );
  if (album) await goto(albumPath(album, "/edit"));
  return Boolean(album);
}

const renameFolder = (name: string) =>
  renameTarget
    ? attempt(() => patch(`/folders/${renameTarget?.id}`, { name })).then(Boolean)
    : false;

const deleteFolder = () =>
  deleteTarget ? attempt(() => del(`/folders/${deleteTarget?.id}`), "Folder deleted") : null;
</script>

<div class="mb-10 flex flex-wrap items-end justify-between gap-4">
  <div>
    <Breadcrumb.Root class="mb-2">
      <Breadcrumb.List>
        <Breadcrumb.Item>
          {#if folder}
            <Breadcrumb.Link href="/">Library</Breadcrumb.Link>
          {:else}
            <Breadcrumb.Page>Library</Breadcrumb.Page>
          {/if}
        </Breadcrumb.Item>
        {#each trail as f, i (f.id)}
          <Breadcrumb.Separator />
          <Breadcrumb.Item>
            {#if i < trail.length - 1}
              <Breadcrumb.Link href="/folders/{f.id}">{f.name}</Breadcrumb.Link>
            {:else}
              <Breadcrumb.Page>{f.name}</Breadcrumb.Page>
            {/if}
          </Breadcrumb.Item>
        {/each}
      </Breadcrumb.List>
    </Breadcrumb.Root>
    <h1 class="font-heading text-4xl">{folder?.name ?? 'Library'}</h1>
  </div>
  <div class="flex gap-2">
    <Button variant="outline" onclick={() => (newFolderOpen = true)}>
      <FolderPlus />
      Folder
    </Button>
    <Button onclick={() => (newAlbumOpen = true)}><Plus /> Album</Button>
  </div>
</div>

{#if folders.length > 0}
  <section class="mb-12">
    <h2 class="mb-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
      Folders
    </h2>
    <div class="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {#each folders as f (f.id)}
        <FolderCard
          folder={f}
          onrename={() => {
            renameTarget = f;
            renameOpen = true;
          }}
          ondelete={() => {
            deleteTarget = f;
            deleteOpen = true;
          }}
        />
      {/each}
    </div>
  </section>
{/if}

<section>
  {#if folders.length > 0}
    <h2 class="mb-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
      Albums
    </h2>
  {/if}
  {#if albums.length === 0}
    <div class="rounded-2xl border border-dashed px-6 py-16 text-center text-muted-foreground">
      {folder ? 'No albums in this folder yet.' : 'No albums yet. Create the first one.'}
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {#each albums as album (album.id)}
        <AlbumCard {album} />
      {/each}
    </div>
  {/if}
</section>

<PromptDialog
  bind:open={newFolderOpen}
  title="New folder"
  label="Name"
  submitLabel="Create"
  onsubmit={createFolder}
/>
<PromptDialog
  bind:open={newAlbumOpen}
  title="New album"
  label="Title"
  submitLabel="Create"
  onsubmit={createAlbum}
/>
<PromptDialog
  bind:open={renameOpen}
  title="Rename folder"
  label="Name"
  value={renameTarget?.name ?? ''}
  onsubmit={renameFolder}
/>
<ConfirmDialog
  bind:open={deleteOpen}
  title={`Delete “${deleteTarget?.name ?? ''}”?`}
  description="Only empty folders can be deleted. Move or delete its albums and sub-folders first."
  onconfirm={deleteFolder}
/>
