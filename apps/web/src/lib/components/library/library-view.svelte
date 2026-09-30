<script lang="ts">
import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
import Ellipsis from "@lucide/svelte/icons/ellipsis";
import FolderPlus from "@lucide/svelte/icons/folder-plus";
import Plus from "@lucide/svelte/icons/plus";
import Share from "@lucide/svelte/icons/share-2";
import type { Album, Folder, FolderTile, SortMode } from "@sammelband/shared";
import { flip } from "svelte/animate";
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
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { albumPath } from "$lib/links";
import { m } from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils";
import SortMenu, { SORT_OPTIONS } from "./sort-menu.svelte";

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
  if (result && sort !== "manual") toast.info(m.sort_switched_manual());
  await invalidateAll();
}

/** Keyboard/touch alternative to dragging: one step earlier or later. */
function step(kind: Kind, id: string, delta: -1 | 1) {
  const list = listOf(kind);
  const i = list.findIndex((x) => x.id === id);
  const beforeId = delta < 0 ? list[i - 1]?.id : (list[i + 2]?.id ?? null);
  if (beforeId !== undefined) void move(kind, id, beforeId);
}

// Drag and drop (desktop), like a sortable list: while dragging, the other
// tiles make room and a dashed placeholder shows where the item will land;
// dropping commits that order. Dropping onto a folder (its middle, for
// folders) or a breadcrumb moves the item into that folder, after a
// confirmation. The drag image is a small card, easier to aim with.
type Drag = { kind: Kind; id: string };
let drag = $state<Drag | null>(null);
/** The order shown while dragging (ids of the dragged kind). */
let preview = $state<string[] | null>(null);
/** A folder tile the item would move into. */
let intoTarget = $state<string | null>(null);
let crumbTarget = $state<string | null>(null); // folder id, or "root"
let lastShift = 0;

const byId = <T extends { id: string }>(list: T[], ids: string[]) =>
  ids.map((id) => list.find((i) => i.id === id)).filter((i): i is T => i !== undefined);
const shownFolders = $derived(
  drag?.kind === "folder" && preview ? byId(folderOrder, preview) : folderOrder,
);
const shownAlbums = $derived(
  drag?.kind === "album" && preview ? byId(albumOrder, preview) : albumOrder,
);

function startDrag(e: DragEvent, kind: Kind, id: string) {
  drag = { kind, id };
  preview = listOf(kind).map((i) => i.id);
  setDragImage(e);
}

/** A small card (first image + title) as the drag image instead of the whole tile. */
function setDragImage(e: DragEvent) {
  const tile = e.currentTarget as HTMLElement;
  const card = document.createElement("div");
  card.style.cssText =
    "position:fixed;top:-1000px;left:-1000px;width:140px;padding:6px;border-radius:12px;" +
    "background:var(--card);color:var(--foreground);box-shadow:0 8px 24px rgb(0 0 0 / .25);" +
    "font:600 12px/1.3 system-ui,sans-serif";
  const img = tile.querySelector("img");
  const picture = img ? (img.cloneNode() as HTMLElement) : document.createElement("div");
  picture.style.cssText =
    "display:block;width:128px;height:96px;object-fit:cover;border-radius:8px;background:var(--muted)";
  const title = document.createElement("div");
  title.textContent = tile.querySelector("h3")?.textContent?.trim() ?? "";
  title.style.cssText = "margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  card.append(picture, title);
  document.body.append(card);
  e.dataTransfer?.setDragImage(card, 70, 50);
  setTimeout(() => card.remove());
}

/** Make room at `targetId`: the dragged item takes its place, from either side. */
function shiftTo(targetId: string) {
  if (!drag || !preview || targetId === drag.id) return;
  // Tiles are still sliding into place; hit-testing them now would bounce back.
  if (performance.now() - lastShift < 180) return;
  const from = preview.indexOf(drag.id);
  const to = preview.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return;
  const next = [...preview];
  next.splice(from, 1);
  next.splice(to, 0, drag.id);
  preview = next;
  lastShift = performance.now();
}

function dragOverFolder(e: DragEvent, f: FolderTile) {
  if (!drag || drag.id === f.id) return;
  e.preventDefault();
  e.stopPropagation();
  // Albums always go into a folder. Folders: the middle moves into it, the
  // outer quarters make room next to it.
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  if (drag.kind === "album" || (x >= 0.25 && x <= 0.75)) {
    intoTarget = f.id;
  } else {
    intoTarget = null;
    shiftTo(f.id);
  }
}

function dragOverAlbum(e: DragEvent, album: Album) {
  if (drag?.kind !== "album") return;
  e.preventDefault();
  e.stopPropagation();
  intoTarget = null;
  shiftTo(album.id);
}

/** Dropping anywhere in the grid of the dragged kind commits the shown order. */
function dragOverGrid(e: DragEvent, kind: Kind) {
  if (drag?.kind !== kind) return;
  e.preventDefault();
}

function drop(e: DragEvent) {
  e.preventDefault();
  e.stopPropagation();
  const d = drag;
  const order = preview;
  const into = intoTarget;
  endDrag();
  if (!d) return;
  if (into) {
    askMove(d, folderOrder.find((f) => f.id === into) ?? null);
    return;
  }
  if (!order) return;
  const original = listOf(d.kind).map((i) => i.id);
  if (order.join() === original.join()) return;
  void move(d.kind, d.id, order[order.indexOf(d.id) + 1] ?? null);
}

/** Leaving a folder tile ends "move into" (entering its children doesn't). */
function leaveFolder(e: DragEvent, id: string) {
  const tile = e.currentTarget as HTMLElement;
  if (intoTarget === id && !tile.contains(e.relatedTarget as Node | null)) intoTarget = null;
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

/** Also runs when the drop lands outside any target: the original order comes back. */
function endDrag() {
  drag = null;
  preview = null;
  intoTarget = null;
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
  const request = moveRequest;
  if (!request) return;
  const folderId = request.into?.id ?? null;
  const ok = await attempt(
    () =>
      request.kind === "album"
        ? patch(`/albums/${request.id}`, { folderId })
        : patch(`/folders/${request.id}`, { parentId: folderId }),
    request.into
      ? m.move_done_folder({ name: request.name, folder: request.into.name })
      : m.move_done_library({ name: request.name }),
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
let shareOpen = $state(false);
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
  deleteTarget ? attempt(() => del(`/folders/${deleteTarget?.id}`), m.folder_deleted()) : null;
</script>

{#snippet mobileMenu()}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger class="sm:hidden">
      {#snippet child({ props })}
        <Button {...props} variant="outline" size="icon" aria-label={m.common_more_actions()}>
          <Ellipsis />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="min-w-52">
      <DropdownMenu.Item onclick={() => (newAlbumOpen = true)}
        ><Plus /> {m.album_new()}</DropdownMenu.Item
      >
      <DropdownMenu.Item onclick={() => (newFolderOpen = true)}
        ><FolderPlus />
        {m.folder_new()}</DropdownMenu.Item
      >
      {#if folder}
        <DropdownMenu.Item onclick={() => (shareOpen = true)}
          ><Share /> {m.share()}</DropdownMenu.Item
        >
      {/if}
      <DropdownMenu.Separator />
      <!-- Inline rather than a submenu: those open off-screen on phones. -->
      <DropdownMenu.Label class="flex items-center gap-2"
        ><ArrowDownUp class="size-4" />
        {m.sort_by()}</DropdownMenu.Label
      >
      <DropdownMenu.RadioGroup value={sort} onValueChange={(v) => v !== sort && setSort(v)}>
        {#each SORT_OPTIONS as o (o.value)}
          <DropdownMenu.RadioItem value={o.value}>{o.label}</DropdownMenu.RadioItem>
        {/each}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/snippet}

<div class="mb-10 flex flex-wrap items-end justify-between gap-4">
  <div class="min-w-0 flex-1">
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
              {m.nav_library()}
            </Breadcrumb.Link>
          {:else}
            <Breadcrumb.Page>{m.nav_library()}</Breadcrumb.Page>
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
    <div class="flex items-start justify-between gap-2">
      <h1 class="min-w-0 font-heading text-4xl">{folder?.name ?? m.nav_library()}</h1>
      {@render mobileMenu()}
    </div>
  </div>
  <!-- Phones get the same actions from the "⋯" menu next to the title. -->
  <div class="hidden flex-wrap items-center gap-2 sm:flex">
    <SortMenu value={sort} onchange={setSort} />
    {#if folder}
      <ShareButton target={{ folderId: folder.id }} name={folder.name} bind:open={shareOpen} />
    {/if}
    <Button variant="outline" onclick={() => (newFolderOpen = true)}>
      <FolderPlus />
      {m.folder_badge()}
    </Button>
    <Button onclick={() => (newAlbumOpen = true)}><Plus /> {m.album_badge()}</Button>
  </div>
</div>

<!-- Drag feedback: a dashed placeholder where the dragged item will land, or "Move into". -->
{#snippet dropOverlay(id: string, name = "")}
  {#if drag?.id === id && !intoTarget}
    <div
      class="pointer-events-none absolute -inset-2 rounded-2xl border-2 border-dashed border-primary/60 bg-primary/5"
    ></div>
  {:else if intoTarget === id}
    <div
      class="pointer-events-none absolute -inset-2 flex items-center justify-center rounded-2xl bg-primary/10 ring-2 ring-primary"
    >
      <span class="rounded-full bg-background px-3 py-1 text-sm font-medium shadow">
        {m.move_into({ name })}
      </span>
    </div>
  {/if}
{/snippet}

{#if sort === 'manual' && folderOrder.length + albumOrder.length > 1}
  <p class="-mt-6 mb-8 hidden text-sm text-muted-foreground sm:block">
    {m.library_drag_hint()}
  </p>
{/if}

{#if folderOrder.length > 0}
  <section class="mb-12">
    <h2 class="mb-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
      {m.library_folders()}
    </h2>
    <ul
      class="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3"
      ondragover={(e) => dragOverGrid(e, 'folder')}
      ondrop={drop}
    >
      {#each shownFolders as f, i (f.id)}
        <li
          class="relative"
          animate:flip={{ duration: 180 }}
          draggable="true"
          ondragstart={(e) => startDrag(e, 'folder', f.id)}
          ondragend={endDrag}
          ondragover={(e) => dragOverFolder(e, f)}
          ondragleave={(e) => leaveFolder(e, f.id)}
          ondrop={drop}
        >
          <div class={cn('transition-opacity', drag?.id === f.id && 'opacity-25')}>
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
          </div>
          {@render dropOverlay(f.id, f.name)}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section>
  {#if folderOrder.length > 0 && albumOrder.length > 0}
    <h2 class="mb-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
      {m.library_albums()}
    </h2>
  {/if}
  {#if albumOrder.length === 0 && folderOrder.length === 0}
    <!-- Only when there's nothing at all; otherwise an empty albums area just gets in the way. -->
    <p class="py-10 text-center text-sm text-muted-foreground">
      {folder ? m.folder_is_empty() : m.library_empty()}
    </p>
  {:else if albumOrder.length > 0}
    <ul
      class="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3"
      ondragover={(e) => dragOverGrid(e, 'album')}
      ondrop={drop}
    >
      {#each shownAlbums as album, i (album.id)}
        <li
          class="relative"
          animate:flip={{ duration: 180 }}
          draggable="true"
          ondragstart={(e) => startDrag(e, 'album', album.id)}
          ondragend={endDrag}
          ondragover={(e) => dragOverAlbum(e, album)}
          ondrop={drop}
        >
          <div class={cn('transition-opacity', drag?.id === album.id && 'opacity-25')}>
            <AlbumCard {album}>
              {#snippet menu()}
                <MoveMenuItems
                  first={i === 0}
                  last={i === albumOrder.length - 1}
                  onmove={(d) => step('album', album.id, d)}
                />
              {/snippet}
            </AlbumCard>
          </div>
          {@render dropOverlay(album.id)}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<ConfirmDialog
  bind:open={moveOpen}
  title={moveRequest?.into
    ? m.move_confirm_folder({ name: moveRequest?.name ?? '', folder: moveRequest.into.name })
    : m.move_confirm_library({ name: moveRequest?.name ?? '' })}
  description={moveRequest?.kind === 'folder'
    ? m.move_confirm_folder_description()
    : m.move_confirm_album_description()}
  confirmLabel={m.move()}
  onconfirm={confirmMove}
/>

<PromptDialog
  bind:open={newFolderOpen}
  title={m.folder_new()}
  label={m.common_name()}
  submitLabel={m.common_create()}
  onsubmit={createFolder}
/>
<PromptDialog
  bind:open={newAlbumOpen}
  title={m.album_new()}
  label={m.common_title()}
  submitLabel={m.common_create()}
  onsubmit={createAlbum}
/>
<PromptDialog
  bind:open={renameOpen}
  title={m.folder_rename()}
  label={m.common_name()}
  value={renameTarget?.name ?? ''}
  onsubmit={renameFolder}
/>
<ConfirmDialog
  bind:open={deleteOpen}
  title={m.folder_delete_confirm({ name: deleteTarget?.name ?? '' })}
  description={m.folder_delete_description()}
  onconfirm={deleteFolder}
/>
