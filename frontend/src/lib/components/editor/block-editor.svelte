<script lang="ts">
import GripVertical from "@lucide/svelte/icons/grip-vertical";
import Heading from "@lucide/svelte/icons/heading";
import Images from "@lucide/svelte/icons/images";
import SquareDashed from "@lucide/svelte/icons/square-dashed";
import Trash from "@lucide/svelte/icons/trash-2";
import Type from "@lucide/svelte/icons/type";
import { SvelteMap } from "svelte/reactivity";
import { del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
import SimpleSelect from "$lib/components/app/simple-select.svelte";
import { Button } from "$lib/components/ui/button";
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
  heading: { level: 2, text: "Heading" },
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
const groups = $derived(topLevel.filter((b) => b.type === "group"));
const groupOptions = $derived([
  { value: "", label: "Top level" },
  ...groups.map((g, i) => ({ value: g.id, label: `Group ${i + 1}` })),
]);
const photosOf = (blockId: string) => photos.filter((p) => p.block_id === blockId).sort(bySort);

// Unsaved edits per block. Live reloads replace `blocks`, drafts survive.
const drafts = new SvelteMap<string, Content>();
const contentOf = (b: AlbumBlock): Content => drafts.get(b.id) ?? parseContent<Content>(b);
const setDraft = (b: AlbumBlock, change: Content) =>
  drafts.set(b.id, { ...contentOf(b), ...change });
const isDirty = (b: AlbumBlock) => {
  const d = drafts.get(b.id);
  return d !== undefined && JSON.stringify(d) !== JSON.stringify(parseContent(b));
};

async function add(type: BlockType, parentId: string | null = null) {
  const last = siblingsOf(parentId).at(-1);
  await attempt(() =>
    post(`/albums/${albumId}/blocks`, {
      type,
      content: DEFAULT_CONTENT[type],
      parentId,
      afterId: last?.id,
    }),
  );
}

async function save(b: AlbumBlock) {
  const content = drafts.get(b.id);
  if (!content) return;
  const ok = await attempt(() => patch(`/albums/${albumId}/blocks/${b.id}`, { content }));
  if (ok) drafts.delete(b.id);
}

const moveTo = (b: AlbumBlock, parentId: string | null) =>
  attempt(() => patch(`/albums/${albumId}/blocks/${b.id}`, { parentId }));

let deleteTarget = $state<AlbumBlock | null>(null);
let deleteOpen = $state(false);

// Drag reorder, scoped to siblings of the same parent.
let dragId = $state<string | null>(null);
let dropTarget = $state<{ id: string; after: boolean } | null>(null);

function dragOver(e: DragEvent, b: AlbumBlock) {
  const dragged = blocks.find((x) => x.id === dragId);
  if (!dragged || dragged.id === b.id || dragged.parent_id !== b.parent_id) return;
  e.preventDefault();
  e.stopPropagation();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropTarget = { id: b.id, after: e.clientY > rect.top + rect.height / 2 };
}

async function drop(e: DragEvent, target: AlbumBlock) {
  e.preventDefault();
  e.stopPropagation();
  const after = dropTarget?.after ?? false;
  const draggedId = dragId;
  dragId = null;
  dropTarget = null;
  const siblings = siblingsOf(target.parent_id ?? null);
  const from = siblings.findIndex((b) => b.id === draggedId);
  if (from === -1 || draggedId === target.id) return;
  const [moved] = siblings.splice(from, 1);
  if (!moved) return;
  siblings.splice(siblings.findIndex((b) => b.id === target.id) + (after ? 1 : 0), 0, moved);
  await attempt(() =>
    post(`/albums/${albumId}/blocks/reorder`, {
      order: siblings.map((b, i) => ({ id: b.id, sortOrder: i + 1 })),
    }),
  );
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
        aria-label="Drag to reorder"
        class="cursor-grab text-muted-foreground"
        draggable="true"
        ondragstart={(e) => {
					dragId = b.id;
					e.dataTransfer?.setData('text/plain', b.id);
				}}
        ondragend={() => {
					dragId = null;
					dropTarget = null;
				}}
      >
        <GripVertical class="size-4" />
      </span>
      <span class="flex-1 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {b.type}
      </span>
      {#if b.type !== 'group' && groups.length > 0}
        <SimpleSelect
          label="Group"
          value={b.parent_id ?? ''}
          options={groupOptions}
          onchange={(v) => moveTo(b, v || null)}
          class="w-32"
        />
      {/if}
      {#if isDirty(b)}
        <Button size="sm" onclick={() => save(b)}>Save</Button>
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
          onchange={(v) => setDraft(b, { level: Number(v) })}
          class="w-20"
        />
        <Input
          value={String(c.text ?? '')}
          oninput={(e) => setDraft(b, { text: e.currentTarget.value })}
        />
      </div>
    {:else if b.type === 'text'}
      <Textarea
        rows={6}
        placeholder="Write something. Blank lines separate paragraphs."
        value={String(c.markdown ?? '')}
        oninput={(e) => setDraft(b, { markdown: e.currentTarget.value })}
      />
    {:else if b.type === 'gallery'}
      <div class="mb-3">
        <SimpleSelect
          label="Layout"
          value={String(c.layout ?? 'grid')}
          options={LAYOUTS}
          onchange={(v) => setDraft(b, { layout: v })}
        />
      </div>
      <GalleryPhotos blockId={b.id} photos={photosOf(b.id)} />
    {:else if b.type === 'group'}
      <div class="mb-4">
        <SimpleSelect
          label="Background"
          value={String(c.background ?? 'none')}
          options={BACKGROUNDS}
          onchange={(v) => setDraft(b, { background: v })}
          class="w-48"
        />
      </div>
      <div class="grid gap-3 border-l-2 border-muted-foreground/30 pl-4">
        {#each siblingsOf(b.id) as child (child.id)}
          {@render card(child)}
        {:else}
          <p class="text-sm text-muted-foreground">
            Empty group. Add blocks here, or move existing ones in with their Group selector.
          </p>
        {/each}
        {@render addButtons(b.id)}
      </div>
    {/if}
  </div>
{/snippet}

<div class="grid gap-4">
  {#each topLevel as b (b.id)}
    {@render card(b)}
  {:else}
    <p class="rounded-2xl border border-dashed px-6 py-10 text-center text-muted-foreground">
      No blocks yet. Start with a heading, some text or a gallery.
    </p>
  {/each}
  <div
    class="sticky bottom-4 z-10 w-fit rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur"
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
