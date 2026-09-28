<script lang="ts">
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Plus from "@lucide/svelte/icons/plus";
import Share from "@lucide/svelte/icons/share-2";
import { toast } from "svelte-sonner";
import { goto, invalidateAll } from "$app/navigation";
import { api, del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import * as Breadcrumb from "$lib/components/ui/breadcrumb";
import { Button } from "$lib/components/ui/button";
import { albumPath } from "$lib/links";
import type { Album, Folder, FolderTile, SortMode } from "$lib/types";
import { cn } from "$lib/utils";
import AlbumCard from "./album-card.svelte";
import ConfirmDialog from "./confirm-dialog.svelte";
import FolderCard from "./folder-card.svelte";
import MoveMenuItems from "./move-menu-items.svelte";
import PromptDialog from "./prompt-dialog.svelte";
import ShareDialog from "./share-dialog.svelte";
import SimpleSelect from "./simple-select.svelte";

/** Contents of one folder (or the root when `folder` is null). */
let {
  folder,
  folders,
  albums,
  sort,
  allFolders,
}: {
  folder: Folder | null;
  folders: FolderTile[];
  albums: Album[];
  sort: SortMode;
  allFolders: Folder[];
} = $props();

// --- Sort order (per user and folder) ------------------------------------------

const SORT_OPTIONS = [
  { value: "created", label: "Newest first" },
  { value: "name", label: "Name" },
  { value: "modified", label: "Recently changed" },
  { value: "manual", label: "Manual" },
];
/** API base of this container: the library root or the folder. */
const base = $derived(folder ? `/folders/${folder.id}` : "/library");

async function setSort(mode: string) {
  if (await attempt(() => api(`${base}/sort`, { method: "PUT", body: { mode } }))) {
    await invalidateAll();
  }
}

// Shown order; moves update it right away and the reload confirms it.
let folderOrder = $derived(folders);
let albumOrder = $derived(albums);

type Kind = "album" | "folder";
const listOf = (kind: Kind): { id: string }[] => (kind === "album" ? albumOrder : folderOrder);

/** Move an item before `beforeId` (null: to the end). Switches to manual order. */
async function move(kind: Kind, id: string, beforeId: string | null) {
  const list = listOf(kind);
  const item = list.find((i) => i.id === id);
  if (!item || id === beforeId) return;
  const rest = list.filter((i) => i.id !== id);
  const index = beforeId ? rest.findIndex((i) => i.id === beforeId) : rest.length;
  const reordered = [...rest.slice(0, index), item, ...rest.slice(index)];
  if (kind === "album") albumOrder = reordered as Album[];
  else folderOrder = reordered as FolderTile[];

  const result = await attempt(() =>
    post<{ sort: SortMode }>(`${base}/order`, { kind, id, beforeId }),
  );
  if (result && sort !== "manual") toast.info("Switched to manual order");
  await invalidateAll();
}

/** Keyboard/touch alternative to dragging: one step earlier or later. */
function step(kind: Kind, id: string, delta: -1 | 1) {
  const list = listOf(kind);
  const i = list.findIndex((x) => x.id === id);
  const beforeId = delta < 0 ? list[i - 1]?.id : (list[i + 2]?.id ?? null);
  if (beforeId !== undefined) void move(kind, id, beforeId);
}

// Drag and drop (desktop): drop on the left or right half of another tile.
let drag = $state<{ kind: Kind; id: string } | null>(null);
let dropTarget = $state<{ id: string; after: boolean } | null>(null);

function dragOver(e: DragEvent, kind: Kind, id: string) {
  if (!drag || drag.kind !== kind || drag.id === id) return;
  e.preventDefault();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropTarget = { id, after: e.clientX > rect.left + rect.width / 2 };
}

function dropOn(e: DragEvent, kind: Kind, id: string) {
  e.preventDefault();
  if (!drag || drag.kind !== kind || !dropTarget) return;
  const list = listOf(kind).filter((i) => i.id !== drag?.id);
  const target = list.findIndex((i) => i.id === id);
  const beforeId = dropTarget.after ? (list[target + 1]?.id ?? null) : id;
  const dragged = drag.id;
  endDrag();
  void move(kind, dragged, beforeId);
}

function endDrag() {
  drag = null;
  dropTarget = null;
}

const trail = $derived.by(() => {
  const chain: Folder[] = [];
  let current = folder;
  while (current) {
    chain.unshift(current);
    current = allFolders.find((f) => f.id === current?.parent_id) ?? null;
  }
  return chain;
});

let shareOpen = $state(false);
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
  <div class="flex flex-wrap items-center gap-2">
    <SimpleSelect
      label="Sort order"
      value={sort}
      options={SORT_OPTIONS}
      onchange={setSort}
      class="w-44"
    />
    {#if folder}
      <Button variant="outline" onclick={() => (shareOpen = true)}><Share /> Share</Button>
    {/if}
    <Button variant="outline" onclick={() => (newFolderOpen = true)}>
      <FolderPlus />
      Folder
    </Button>
    <Button onclick={() => (newAlbumOpen = true)}><Plus /> Album</Button>
  </div>
</div>

{#snippet dropIndicator(id: string)}
  {#if dropTarget?.id === id}
    <div
      class={cn(
        'pointer-events-none absolute inset-y-0 w-1 rounded-full bg-primary',
        dropTarget.after ? '-right-3.5' : '-left-3.5'
      )}
    ></div>
  {/if}
{/snippet}

{#if sort === 'manual' && folderOrder.length + albumOrder.length > 1}
  <p class="-mt-6 mb-8 hidden text-sm text-muted-foreground sm:block">
    Drag folders and albums to arrange them.
  </p>
{/if}

{#if folderOrder.length > 0}
  <section class="mb-12">
    <h2 class="mb-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
      Folders
    </h2>
    <div class="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {#each folderOrder as f, i (f.id)}
        <div
          role="listitem"
          class={cn('relative', drag?.id === f.id && 'opacity-40')}
          draggable="true"
          ondragstart={() => (drag = { kind: 'folder', id: f.id })}
          ondragend={endDrag}
          ondragover={(e) => dragOver(e, 'folder', f.id)}
          ondrop={(e) => dropOn(e, 'folder', f.id)}
        >
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
          >
            {#snippet menu()}
              <MoveMenuItems
                first={i === 0}
                last={i === folderOrder.length - 1}
                onmove={(d) => step('folder', f.id, d)}
              />
            {/snippet}
          </FolderCard>
          {@render dropIndicator(f.id)}
        </div>
      {/each}
    </div>
  </section>
{/if}

<section>
  {#if folderOrder.length > 0}
    <h2 class="mb-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
      Albums
    </h2>
  {/if}
  {#if albumOrder.length === 0}
    <div class="rounded-2xl border border-dashed px-6 py-16 text-center text-muted-foreground">
      {folder ? 'No albums in this folder yet.' : 'No albums yet. Create the first one.'}
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {#each albumOrder as album, i (album.id)}
        <div
          role="listitem"
          class={cn('relative', drag?.id === album.id && 'opacity-40')}
          draggable="true"
          ondragstart={() => (drag = { kind: 'album', id: album.id })}
          ondragend={endDrag}
          ondragover={(e) => dragOver(e, 'album', album.id)}
          ondrop={(e) => dropOn(e, 'album', album.id)}
        >
          <AlbumCard {album}>
            {#snippet menu()}
              <MoveMenuItems
                first={i === 0}
                last={i === albumOrder.length - 1}
                onmove={(d) => step('album', album.id, d)}
              />
            {/snippet}
          </AlbumCard>
          {@render dropIndicator(album.id)}
        </div>
      {/each}
    </div>
  {/if}
</section>

{#if folder}
  <ShareDialog bind:open={shareOpen} target={{ folderId: folder.id }} name={folder.name} />
{/if}
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
