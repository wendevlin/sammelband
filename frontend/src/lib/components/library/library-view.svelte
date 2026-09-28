<script lang="ts">
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Plus from "@lucide/svelte/icons/plus";
import { toast } from "svelte-sonner";
import { goto, invalidateAll } from "$app/navigation";
import { api, del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import PromptDialog from "$lib/components/dialogs/prompt-dialog.svelte";
import AlbumCard from "$lib/components/library/album-card.svelte";
import FolderCard from "$lib/components/library/folder-card.svelte";
import MoveMenuItems from "$lib/components/library/move-menu-items.svelte";
import ShareButton from "$lib/components/share/share-button.svelte";
import * as Breadcrumb from "$lib/components/ui/breadcrumb";
import { Button } from "$lib/components/ui/button";
import { albumPath } from "$lib/links";
import type { Album, Folder, FolderTile, SortMode } from "$lib/types";
import { cn } from "$lib/utils";
import SortMenu from "./sort-menu.svelte";

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

// Drag and drop (desktop). Dropping onto a tile of the same kind takes its
// place; dropping onto a folder (its middle, for folders) or a breadcrumb
// moves the item into that folder, after a confirmation.
type Hover = { id: string; mode: "reorder" | "into" };
let drag = $state<{ kind: Kind; id: string } | null>(null);
let hover = $state<Hover | null>(null);
let crumbTarget = $state<string | null>(null); // folder id, or "root"

function dragOverFolder(e: DragEvent, f: FolderTile) {
  if (!drag || drag.id === f.id) return;
  let mode: Hover["mode"] = "into";
  if (drag.kind === "folder") {
    // Outer quarters reorder, the middle moves into the folder.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (x < 0.25 || x > 0.75) mode = "reorder";
  }
  e.preventDefault();
  hover = { id: f.id, mode };
}

function dragOverAlbum(e: DragEvent, album: Album) {
  if (drag?.kind !== "album" || drag.id === album.id) return;
  e.preventDefault();
  hover = { id: album.id, mode: "reorder" };
}

/** Move `id` into the place of `targetId`, from either side. */
function reorderOnto(kind: Kind, id: string, targetId: string) {
  const list = listOf(kind);
  const from = list.findIndex((i) => i.id === id);
  const to = list.findIndex((i) => i.id === targetId);
  const rest = list.filter((i) => i.id !== id);
  const at = rest.findIndex((i) => i.id === targetId);
  const beforeId = from < to ? (rest[at + 1]?.id ?? null) : targetId;
  void move(kind, id, beforeId);
}

function dropOnTile(e: DragEvent, targetId: string) {
  e.preventDefault();
  const d = drag;
  const h = hover;
  endDrag();
  if (!d || !h || h.id !== targetId) return;
  if (h.mode === "reorder") reorderOnto(d.kind, d.id, targetId);
  else askMove(d, folderOrder.find((f) => f.id === targetId) ?? null);
}

/** Clear the feedback when the pointer really leaves a tile (not just enters a child). */
function leaveTile(e: DragEvent, id: string) {
  const tile = e.currentTarget as HTMLElement;
  if (hover?.id === id && !tile.contains(e.relatedTarget as Node | null)) hover = null;
}

function dragOverCrumb(e: DragEvent, key: string) {
  if (!drag) return;
  e.preventDefault();
  crumbTarget = key;
}

function dropOnCrumb(e: DragEvent, target: Folder | null) {
  e.preventDefault();
  const d = drag;
  endDrag();
  if (d) askMove(d, target);
}

function endDrag() {
  drag = null;
  hover = null;
  crumbTarget = null;
}

// Moving into another folder, confirmed first.
let moveRequest = $state<{ kind: Kind; id: string; name: string; into: Folder | null } | null>(
  null,
);
let moveOpen = $state(false);

function askMove(d: { kind: Kind; id: string }, into: Folder | null) {
  const name =
    d.kind === "album"
      ? albumOrder.find((a) => a.id === d.id)?.title
      : folderOrder.find((f) => f.id === d.id)?.name;
  if (!name || (into?.id ?? null) === (folder?.id ?? null)) return;
  moveRequest = { ...d, name, into };
  moveOpen = true;
}

async function confirmMove() {
  const m = moveRequest;
  if (!m) return;
  const folderId = m.into?.id ?? null;
  const ok = await attempt(
    () =>
      m.kind === "album"
        ? patch(`/albums/${m.id}`, { folderId })
        : patch(`/folders/${m.id}`, { parentId: folderId }),
    `Moved “${m.name}” to ${m.into?.name ?? "the library"}`,
  );
  if (ok) await invalidateAll();
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
            <Breadcrumb.Link
              href="/"
              class={cn('rounded px-1 -mx-1', crumbTarget === 'root' && 'bg-primary/15 ring-2 ring-primary')}
              ondragover={(e: DragEvent) => dragOverCrumb(e, 'root')}
              ondragleave={() => (crumbTarget = null)}
              ondrop={(e: DragEvent) => dropOnCrumb(e, null)}
            >
              Library
            </Breadcrumb.Link>
          {:else}
            <Breadcrumb.Page>Library</Breadcrumb.Page>
          {/if}
        </Breadcrumb.Item>
        {#each trail as f, i (f.id)}
          <Breadcrumb.Separator />
          <Breadcrumb.Item>
            {#if i < trail.length - 1}
              <Breadcrumb.Link
                href="/folders/{f.id}"
                class={cn('rounded px-1 -mx-1', crumbTarget === f.id && 'bg-primary/15 ring-2 ring-primary')}
                ondragover={(e: DragEvent) => dragOverCrumb(e, f.id)}
                ondragleave={() => (crumbTarget = null)}
                ondrop={(e: DragEvent) => dropOnCrumb(e, f)}
              >
                {f.name}
              </Breadcrumb.Link>
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
    <SortMenu value={sort} onchange={setSort} />
    {#if folder}
      <ShareButton target={{ folderId: folder.id }} name={folder.name} />
    {/if}
    <Button variant="outline" onclick={() => (newFolderOpen = true)}>
      <FolderPlus />
      Folder
    </Button>
    <Button onclick={() => (newAlbumOpen = true)}><Plus /> Album</Button>
  </div>
</div>

<!-- Drop feedback over a whole tile: a frame to take its place, or "Move into". -->
{#snippet dropOverlay(id: string, name = "")}
  {#if hover?.id === id}
    <div
      class={cn(
        'pointer-events-none absolute -inset-2 rounded-2xl ring-2 ring-primary',
        hover.mode === 'into' && 'flex items-center justify-center bg-primary/10'
      )}
    >
      {#if hover.mode === 'into'}
        <span class="rounded-full bg-background px-3 py-1 text-sm font-medium shadow">
          Move into “{name}”
        </span>
      {/if}
    </div>
  {/if}
{/snippet}

{#if sort === 'manual' && folderOrder.length + albumOrder.length > 1}
  <p class="-mt-6 mb-8 hidden text-sm text-muted-foreground sm:block">
    Drag to arrange. Drop onto a folder (or a folder above) to move something into it.
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
          ondragover={(e) => dragOverFolder(e, f)}
          ondragleave={(e) => leaveTile(e, f.id)}
          ondrop={(e) => dropOnTile(e, f.id)}
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
          {@render dropOverlay(f.id, f.name)}
        </div>
      {/each}
    </div>
  </section>
{/if}

<section>
  {#if folderOrder.length > 0 && albumOrder.length > 0}
    <h2 class="mb-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
      Albums
    </h2>
  {/if}
  {#if albumOrder.length === 0 && folderOrder.length === 0}
    <!-- Only when there's nothing at all; otherwise an empty albums area just gets in the way. -->
    <p class="py-10 text-center text-sm text-muted-foreground">
      {folder ? 'This folder is empty.' : 'Nothing here yet. Create a folder or an album to start.'}
    </p>
  {:else if albumOrder.length > 0}
    <div class="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {#each albumOrder as album, i (album.id)}
        <div
          role="listitem"
          class={cn('relative', drag?.id === album.id && 'opacity-40')}
          draggable="true"
          ondragstart={() => (drag = { kind: 'album', id: album.id })}
          ondragend={endDrag}
          ondragover={(e) => dragOverAlbum(e, album)}
          ondragleave={(e) => leaveTile(e, album.id)}
          ondrop={(e) => dropOnTile(e, album.id)}
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
          {@render dropOverlay(album.id)}
        </div>
      {/each}
    </div>
  {/if}
</section>

<ConfirmDialog
  bind:open={moveOpen}
  title={`Move “${moveRequest?.name ?? ''}” to ${moveRequest?.into ? `“${moveRequest.into.name}”` : 'the library'}?`}
  description={moveRequest?.kind === 'folder'
    ? 'The folder moves with everything inside it. Share links keep working; everyone’s manual order for it here is reset.'
    : 'The album leaves this folder. Share links keep working; everyone’s manual order for it here is reset.'}
  confirmLabel="Move"
  onconfirm={confirmMove}
/>

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
