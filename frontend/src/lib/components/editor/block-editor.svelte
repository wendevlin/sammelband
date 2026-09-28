<script lang="ts">
import GripVertical from "@lucide/svelte/icons/grip-vertical";
import Heading from "@lucide/svelte/icons/heading";
import Images from "@lucide/svelte/icons/images";
import Plus from "@lucide/svelte/icons/plus";
import SquareDashed from "@lucide/svelte/icons/square-dashed";
import Trash from "@lucide/svelte/icons/trash-2";
import Type from "@lucide/svelte/icons/type";
import { onDestroy } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import SimpleSelect from "$lib/components/app/simple-select.svelte";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { Input } from "$lib/components/ui/input";
import { Textarea } from "$lib/components/ui/textarea";
import { type AlbumBlock, type BlockType, type Photo, parseContent } from "$lib/types";
import { cn } from "$lib/utils";
import GalleryPhotos from "./gallery-photos.svelte";

let { albumId, blocks, photos }: { albumId: string; blocks: AlbumBlock[]; photos: Photo[] } =
  $props();

type Content = Record<string, unknown>;

const TYPES: { type: BlockType; label: string; icon: typeof Heading }[] = [
  { type: "heading", label: "Heading", icon: Heading },
  { type: "text", label: "Text", icon: Type },
  { type: "gallery", label: "Gallery", icon: Images },
  { type: "group", label: "Group", icon: SquareDashed },
];
const DEFAULT_CONTENT: Record<BlockType, Content> = {
  heading: { level: 2, text: "" },
  text: { markdown: "" },
  gallery: { layout: "grid" },
  group: { background: "none" },
};
const LEVELS = [1, 2, 3].map((l) => ({ value: String(l), label: `H${l}` }));
const LAYOUTS = [
  { value: "grid", label: "Grid" },
  { value: "masonry", label: "Masonry" },
  { value: "strip", label: "Strip" },
];
const BACKGROUNDS = [
  { value: "none", label: "Border only" },
  { value: "auto", label: "Auto (from photos)" },
  { value: "neutral", label: "Neutral" },
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
];

const bySort = (a: { sort_order: number }, b: { sort_order: number }) =>
  a.sort_order - b.sort_order;
const siblingsOf = (parentId: string | null) =>
  blocks.filter((b) => (b.parent_id ?? null) === parentId).sort(bySort);
const topLevel = $derived(siblingsOf(null));
const photosOf = (blockId: string) => photos.filter((p) => p.block_id === blockId).sort(bySort);

// --- Autosave --------------------------------------------------------------------
// Edits live in `drafts` until saved; live reloads replace `blocks`, drafts
// survive. Typing saves after a short pause (and on leaving the field),
// choices in selects save right away.
const SAVE_DELAY_MS = 700;
const drafts = new SvelteMap<string, Content>();
const saving = new SvelteSet<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new SvelteSet<string>();

const contentOf = (b: AlbumBlock): Content => drafts.get(b.id) ?? parseContent<Content>(b);

function change(b: AlbumBlock, patch: Content, delay = SAVE_DELAY_MS) {
  drafts.set(b.id, { ...contentOf(b), ...patch });
  clearTimeout(timers.get(b.id));
  pending.add(b.id);
  timers.set(
    b.id,
    setTimeout(() => void save(b.id), delay),
  );
}

/** Save now instead of waiting for the pause (leaving a field, leaving the page). */
function flush(id: string) {
  if (!timers.has(id)) return;
  clearTimeout(timers.get(id));
  void save(id);
}

async function save(id: string) {
  timers.delete(id);
  pending.delete(id);
  const content = drafts.get(id);
  if (!content) return;
  saving.add(id);
  const ok = await attempt(() => patch(`/albums/${albumId}/blocks/${id}`, { content }));
  saving.delete(id);
  // Keep the draft if the user typed on while this save was in flight.
  if (ok && drafts.get(id) === content) drafts.delete(id);
}

onDestroy(() => {
  for (const id of [...timers.keys()]) flush(id);
});

// --- Adding ------------------------------------------------------------------------

type Anchor = { afterId?: string; beforeId?: string };

/** Add a block among `parentId`'s children: after/before an anchor, or at the end. */
async function add(type: BlockType, parentId: string | null = null, anchor: Anchor = {}) {
  const at =
    anchor.afterId || anchor.beforeId ? anchor : { afterId: siblingsOf(parentId).at(-1)?.id };
  await attempt(() =>
    post(`/albums/${albumId}/blocks`, { type, content: DEFAULT_CONTENT[type], parentId, ...at }),
  );
}

let deleteTarget = $state<AlbumBlock | null>(null);
let deleteOpen = $state(false);

// --- Drag and drop -------------------------------------------------------------------
// Drop on the upper or lower half of a block to go before or after it, also
// into or out of a group (groups themselves stay top-level).
let dragId = $state<string | null>(null);
let dropTarget = $state<{ id: string; after: boolean } | null>(null);
let groupTarget = $state<string | null>(null);

const dragged = () => blocks.find((x) => x.id === dragId);

function dragOver(e: DragEvent, b: AlbumBlock) {
  const d = dragged();
  if (!d || d.id === b.id || (d.type === "group" && b.parent_id !== null)) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropTarget = { id: b.id, after: e.clientY > rect.top + rect.height / 2 };
  groupTarget = null;
}

function endDrag() {
  dragId = null;
  dropTarget = null;
  groupTarget = null;
}

/** Put the dragged block among `parentId`'s children in `order` (ids, dragged included). */
async function place(block: AlbumBlock, parentId: string | null, order: string[]) {
  if ((block.parent_id ?? null) !== parentId) {
    const moved = await attempt(() => patch(`/albums/${albumId}/blocks/${block.id}`, { parentId }));
    if (!moved) return;
  }
  await attempt(() =>
    post(`/albums/${albumId}/blocks/reorder`, {
      order: order.map((id, i) => ({ id, sortOrder: i + 1 })),
    }),
  );
}

async function drop(e: DragEvent, target: AlbumBlock) {
  e.preventDefault();
  e.stopPropagation();
  const d = dragged();
  const after = dropTarget?.after ?? false;
  endDrag();
  if (!d || d.id === target.id) return;
  const parentId = target.parent_id ?? null;
  const order = siblingsOf(parentId)
    .filter((b) => b.id !== d.id)
    .map((b) => b.id);
  order.splice(order.indexOf(target.id) + (after ? 1 : 0), 0, d.id);
  await place(d, parentId, order);
}

async function dropIntoGroup(e: DragEvent, group: AlbumBlock) {
  e.preventDefault();
  e.stopPropagation();
  const d = dragged();
  endDrag();
  if (!d || d.type === "group" || d.parent_id === group.id) return;
  await place(d, group.id, [...siblingsOf(group.id).map((b) => b.id), d.id]);
}
</script>

{#snippet addButtons(parentId: string | null)}
  <div class="flex flex-wrap gap-2">
    {#each TYPES.filter((t) => parentId === null || t.type !== 'group') as t (t.type)}
      <Button variant="outline" size={parentId ? 'xs' : 'sm'} onclick={() => add(t.type, parentId)}>
        <t.icon />
        {t.label}
      </Button>
    {/each}
  </div>
{/snippet}

<!-- A "+" between blocks: add one right here, no dragging needed. -->
{#snippet inserter(parentId: string | null, anchor: Anchor)}
  <div class="group/ins relative flex h-7 items-center justify-center">
    <div
      class="absolute inset-x-0 top-1/2 h-px bg-border opacity-0 transition-opacity group-hover/ins:opacity-100"
    ></div>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="outline"
            size="icon-xs"
            class="relative rounded-full bg-background opacity-30 transition-opacity group-hover/ins:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label="Add a block here"
          >
            <Plus />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="center" class="min-w-40">
        {#each TYPES.filter((t) => parentId === null || t.type !== 'group') as t (t.type)}
          <DropdownMenu.Item onclick={() => add(t.type, parentId, anchor)}>
            <t.icon />
            {t.label}
          </DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
{/snippet}

<!-- Blocks of one parent with "+" before, between and after them. -->
{#snippet list(items: AlbumBlock[], parentId: string | null)}
  {#if items.length > 0}
    {@render inserter(parentId, { beforeId: items[0]?.id })}
  {/if}
  {#each items as b (b.id)}
    {@render card(b)}
    {@render inserter(parentId, { afterId: b.id })}
  {/each}
{/snippet}

{#snippet card(b: AlbumBlock)}
  {@const c = contentOf(b)}
  <div
    role="listitem"
    class={cn(
      'rounded-xl border bg-card p-4 transition-opacity',
      dragId === b.id && 'opacity-40',
      dropTarget?.id === b.id &&
        (dropTarget.after ? 'border-b-4 border-b-primary' : 'border-t-4 border-t-primary')
    )}
    ondragover={(e) => dragOver(e, b)}
    ondrop={(e) => drop(e, b)}
  >
    <div class="mb-3 flex items-center gap-2">
      <span
        role="button"
        tabindex="-1"
        aria-label="Drag to move"
        class="cursor-grab text-muted-foreground"
        draggable="true"
        ondragstart={(e) => {
          dragId = b.id;
          e.dataTransfer?.setData('text/plain', b.id);
        }}
        ondragend={endDrag}
      >
        <GripVertical class="size-4" />
      </span>
      <span class="flex-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {b.type}
      </span>
      {#if saving.has(b.id) || pending.has(b.id)}
        <span class="text-xs text-muted-foreground">Saving…</span>
      {/if}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Delete block"
        onclick={() => {
          deleteTarget = b;
          deleteOpen = true;
        }}
      >
        <Trash />
      </Button>
    </div>

    {#if b.type === 'heading'}
      <div class="flex gap-2">
        <SimpleSelect
          label="Level"
          value={String(c.level ?? 2)}
          options={LEVELS}
          onchange={(v) => change(b, { level: Number(v) }, 0)}
          class="w-20"
        />
        <Input
          placeholder="Heading"
          value={String(c.text ?? '')}
          oninput={(e) => change(b, { text: e.currentTarget.value })}
          onblur={() => flush(b.id)}
        />
      </div>
    {:else if b.type === 'text'}
      <Textarea
        rows={6}
        placeholder="Write something. Blank lines separate paragraphs."
        value={String(c.markdown ?? '')}
        oninput={(e) => change(b, { markdown: e.currentTarget.value })}
        onblur={() => flush(b.id)}
      />
    {:else if b.type === 'gallery'}
      <div class="mb-3">
        <SimpleSelect
          label="Layout"
          value={String(c.layout ?? 'grid')}
          options={LAYOUTS}
          onchange={(v) => change(b, { layout: v }, 0)}
        />
      </div>
      <GalleryPhotos blockId={b.id} photos={photosOf(b.id)} />
    {:else if b.type === 'group'}
      <div class="mb-4">
        <SimpleSelect
          label="Background"
          value={String(c.background ?? 'none')}
          options={BACKGROUNDS}
          onchange={(v) => change(b, { background: v }, 0)}
          class="w-48"
        />
      </div>
      <div class="border-l-2 border-muted-foreground/30 pl-4">
        {#if siblingsOf(b.id).length > 0}
          {@render list(siblingsOf(b.id), b.id)}
        {:else}
          <div
            role="listitem"
            class={cn(
              'mb-3 rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground',
              groupTarget === b.id && 'border-primary bg-muted'
            )}
            ondragover={(e) => {
              const d = dragged();
              if (!d || d.type === 'group') return;
              e.preventDefault();
              e.stopPropagation();
              groupTarget = b.id;
              dropTarget = null;
            }}
            ondragleave={() => (groupTarget = null)}
            ondrop={(e) => dropIntoGroup(e, b)}
          >
            Empty group. Add blocks below, or drag blocks in here.
          </div>
        {/if}
        {@render addButtons(b.id)}
      </div>
    {/if}
  </div>
{/snippet}

<div>
  {#if topLevel.length > 0}
    {@render list(topLevel, null)}
  {:else}
    <p class="rounded-2xl border border-dashed px-6 py-10 text-center text-muted-foreground">
      No blocks yet. Start with a heading, some text or a gallery.
    </p>
  {/if}
  <div
    class="sticky bottom-4 z-10 mt-4 w-fit rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur"
  >
    {@render addButtons(null)}
  </div>
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete this {deleteTarget?.type ?? 'block'}?"
  description={deleteTarget?.type === 'group'
		? 'Everything inside the group is deleted too, including gallery photos.'
		: deleteTarget?.type === 'gallery'
			? 'All photos in this gallery are deleted too.'
			: undefined}
  onconfirm={() =>
		deleteTarget && attempt(() => del(`/albums/${albumId}/blocks/${deleteTarget?.id}`))}
/>
