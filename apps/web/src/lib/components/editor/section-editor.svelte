<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import type { Photo, Section } from "@sammelband/shared";
import { flushSync, tick } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { del, post } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import ConfirmDialog from "#lib/components/dialogs/confirm-dialog.svelte";
import { m } from "#lib/paraglide/messages.js";
import { cn } from "#lib/utils.ts";
import { providePickerMemory } from "./picker-memory";
import SectionCard from "./section-card.svelte";

/**
 * The album's sections, in order, plus one empty section at the end once the
 * last one has content. That one lives only here until it's typed into. The
 * "+" above a section inserts another such empty card there.
 */
let { albumId, sections, photos }: { albumId: string; sections: Section[]; photos: Photo[] } =
  $props();

// Photo pickers reopen in the folder they were in, until the editor closes.
providePickerMemory(() => albumId);

const bySort = (a: { sort_order: number }, b: { sort_order: number }) =>
  a.sort_order - b.sort_order;
const ordered = $derived([...sections].sort(bySort));
const photosOf = (id: string) => photos.filter((p) => p.section_id === id).sort(bySort);
const hasContent = (s: Section) =>
  s.title.trim() !== "" || s.text.trim() !== "" || photos.some((p) => p.section_id === s.id);

/**
 * An empty card inserted with "+", here only until its first input or upload
 * creates the section in its place. It sits before `beforeId`, so it moves
 * with that section. Once that one is deleted, it sits before the section
 * after `afterId` (its upper neighbour when it was added; null: at the top),
 * and without either it's dropped. `focus` counts requests to focus it.
 */
type Insert = { key: string; beforeId: string; afterId: string | null; focus: number };
let inserts = $state<Insert[]>([]);
let insertCount = 0;

function anchorOf(insert: Insert, ids: string[]): string | null {
  if (ids.includes(insert.beforeId)) return insert.beforeId;
  if (insert.afterId === null) return ids[0] ?? null;
  const i = ids.indexOf(insert.afterId);
  return i === -1 ? null : (ids[i + 1] ?? null);
}

// Settle cards whose section went away: they stay before their new neighbour,
// and dropped ones are forgotten (so they can't come back when a section is
// added there later).
$effect(() => {
  const ids = ordered.map((s) => s.id);
  const kept: Insert[] = [];
  for (const insert of inserts) {
    const anchor = anchorOf(insert, ids);
    if (!anchor) continue;
    insert.beforeId = anchor;
    kept.push(insert);
  }
  if (kept.length < inserts.length) inserts = kept;
});

// A created section keeps the key its empty card had, so the card (and the
// field being typed in) stays in place instead of being rebuilt.
const aliases = new SvelteMap<string, string>();
let drafts = $state(0);
const draftKey = $derived(`new-${drafts}`);

/** `slot`: the section a "+" above this card adds a section before (none for the last card). */
type Item = { key: string; section: Section | null; insert: Insert | null; slot: string | null };
const items = $derived.by(() => {
  const ids = ordered.map((s) => s.id);
  const before = new Map<string, Insert[]>();
  for (const insert of inserts) {
    const anchor = anchorOf(insert, ids);
    if (anchor) before.set(anchor, [...(before.get(anchor) ?? []), insert]);
  }
  const list: Item[] = [];
  for (const s of ordered) {
    for (const insert of before.get(s.id) ?? []) {
      list.push({ key: insert.key, section: null, insert, slot: s.id });
    }
    list.push({ key: aliases.get(s.id) ?? s.id, section: s, insert: null, slot: s.id });
  }
  const last = ordered.at(-1);
  if (!last || hasContent(last)) {
    list.push({ key: draftKey, section: null, insert: null, slot: null });
  }
  return list;
});

/** One "+" per gap: above the first card of each slot. */
const opensSlot = (i: number) => items[i].slot !== null && items[i - 1]?.slot !== items[i].slot;
const slotOf = (key: string) => items.find((x) => x.key === key)?.slot ?? null;

let list = $state<HTMLOListElement | null>(null);

function insertBefore(sectionId: string) {
  // Synchronously, so the title is focused while the tap is being handled
  // (phones only open the keyboard then).
  flushSync(() => {
    const here = items.find((x) => x.insert && x.slot === sectionId)?.insert;
    if (here) {
      here.focus++;
      return;
    }
    const ids = ordered.map((s) => s.id);
    inserts.push({
      key: `insert-${++insertCount}`,
      beforeId: sectionId,
      afterId: ids[ids.indexOf(sectionId) - 1] ?? null,
      focus: 1,
    });
  });
}

function created(key: string, id: string) {
  aliases.set(id, key);
  if (key === draftKey) drafts++;
  else inserts = inserts.filter((x) => x.key !== key);
}

/** Remove an inserted card that's still empty, and go back to its "+". */
async function discard(key: string) {
  const slot = slotOf(key);
  inserts = inserts.filter((x) => x.key !== key);
  await tick();
  if (slot) list?.querySelector<HTMLElement>(`[data-insert-before="${CSS.escape(slot)}"]`)?.focus();
}

// Collapsed sections, by id: only for this visit of the editor, so a reload
// shows everything expanded again.
const collapsed = new SvelteSet<string>();
function toggleCollapsed(id: string) {
  if (!collapsed.delete(id)) collapsed.add(id);
}

let deleteTarget = $state<Section | null>(null);
let deleteOpen = $state(false);

// --- Drag and drop -------------------------------------------------------------
// Drop on the upper or lower half of a section to go before or after it.
let dragId = $state<string | null>(null);
let dropTarget = $state<{ id: string; after: boolean } | null>(null);

function dragOver(e: DragEvent, s: Section) {
  if (!dragId || dragId === s.id) return;
  e.preventDefault();
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dropTarget = { id: s.id, after: e.clientY > rect.top + rect.height / 2 };
}

function endDrag() {
  dragId = null;
  dropTarget = null;
}

async function drop(e: DragEvent, target: Section) {
  e.preventDefault();
  const dragged = dragId;
  const after = dropTarget?.after ?? false;
  endDrag();
  if (dragged) await move(dragged, target.id, after);
}

// Touch: the grip is pressed and held, then the section under the finger is
// the target, by the same halves as with the mouse.
function touchOver(x: number, y: number) {
  const li = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-section-id]");
  const id = li?.dataset.sectionId;
  if (!li || !id || id === dragId) {
    dropTarget = null;
    return;
  }
  const rect = li.getBoundingClientRect();
  dropTarget = { id, after: y > rect.top + rect.height / 2 };
}

function touchEnd(dropped: boolean) {
  const dragged = dragId;
  const target = dropTarget;
  endDrag();
  if (dropped && dragged && target) void move(dragged, target.id, target.after);
}

/** Put section `dragged` before or after `targetId`. */
async function move(dragged: string, targetId: string, after: boolean) {
  if (dragged === targetId) return;
  const order = ordered.map((s) => s.id).filter((id) => id !== dragged);
  order.splice(order.indexOf(targetId) + (after ? 1 : 0), 0, dragged);
  await attempt(() =>
    post(`/albums/${albumId}/sections/reorder`, {
      order: order.map((id, i) => ({ id, sortOrder: i + 1 })),
    }),
  );
}
</script>

<ol class="grid gap-4" bind:this={list}>
  {#each items as item, i (item.key)}
    {@const s = item.section}
    <li
      class={cn(
        "relative transition-opacity",
        s && dragId === s.id && "opacity-40",
        s &&
          dropTarget?.id === s.id &&
          (dropTarget.after
            ? "rounded-b-xl border-b-4 border-b-primary"
            : "rounded-t-xl border-t-4 border-t-primary"),
      )}
      data-section-id={s?.id}
      ondragover={(e) => s && dragOver(e, s)}
      ondrop={(e) => s && drop(e, s)}
    >
      {#if item.slot && opensSlot(i)}
        {@render insertButton(item.slot)}
      {/if}
      <SectionCard
        {albumId}
        section={s}
        photos={s ? photosOf(s.id) : []}
        anchor={item.insert ? () => slotOf(item.key) : undefined}
        focusTitle={item.insert?.focus ?? 0}
        collapsed={s !== null && collapsed.has(s.id)}
        ontogglecollapse={s ? () => toggleCollapsed(s.id) : undefined}
        oncreated={(id) => created(item.key, id)}
        ondelete={() => {
          deleteTarget = s;
          deleteOpen = true;
        }}
        ondiscard={item.insert ? () => discard(item.key) : undefined}
        ondragstart={(e) => {
          if (!s) return;
          dragId = s.id;
          e.dataTransfer?.setData("text/plain", s.id);
        }}
        ondragend={endDrag}
        touch={{
          onstart: () => {
            if (s) dragId = s.id;
          },
          onmove: touchOver,
          onend: touchEnd,
        }}
      />
    </li>
  {/each}
</ol>

<!-- Sits on the gap above a card: small with a mouse, a bigger target on touch screens. -->
{#snippet insertButton(sectionId: string)}
  <button
    type="button"
    data-insert-before={sectionId}
    class="absolute -top-2 left-1/2 z-10 flex size-7 -translate-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs transition-colors outline-none hover:border-primary hover:text-primary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 pointer-coarse:size-9"
    aria-label={m.section_insert()}
    title={m.section_insert()}
    onclick={() => insertBefore(sectionId)}
  >
    <Plus class="size-4" />
  </button>
{/snippet}

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.section_delete_confirm()}
  description={m.section_delete_description()}
  onconfirm={() =>
    deleteTarget && attempt(() => del(`/albums/${albumId}/sections/${deleteTarget?.id}`))}
/>
