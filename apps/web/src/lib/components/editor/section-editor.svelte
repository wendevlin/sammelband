<script lang="ts">
import type { Photo, Section } from "@sammelband/shared";
import { SvelteMap } from "svelte/reactivity";
import { del, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import { m } from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils";
import { providePickerMemory } from "./picker-memory";
import SectionCard from "./section-card.svelte";

/**
 * The album's sections, in order, plus one empty section at the end once the
 * last one has content. That one lives only here until it's typed into.
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

// A created section keeps the key its empty card had, so the card (and the
// field being typed in) stays in place instead of being rebuilt.
const aliases = new SvelteMap<string, string>();
const draftKey = $derived(`new-${aliases.size}`);
const items = $derived.by(() => {
  const list: { key: string; section: Section | null }[] = ordered.map((s) => ({
    key: aliases.get(s.id) ?? s.id,
    section: s,
  }));
  const last = ordered.at(-1);
  if (!last || hasContent(last)) list.push({ key: draftKey, section: null });
  return list;
});

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
  if (!dragged || dragged === target.id) return;
  const order = ordered.map((s) => s.id).filter((id) => id !== dragged);
  order.splice(order.indexOf(target.id) + (after ? 1 : 0), 0, dragged);
  await attempt(() =>
    post(`/albums/${albumId}/sections/reorder`, {
      order: order.map((id, i) => ({ id, sortOrder: i + 1 })),
    }),
  );
}
</script>

<ol class="grid gap-4">
  {#each items as item (item.key)}
    {@const s = item.section}
    <li
      class={cn(
        'transition-opacity',
        s && dragId === s.id && 'opacity-40',
        s &&
          dropTarget?.id === s.id &&
          (dropTarget.after
            ? 'rounded-b-xl border-b-4 border-b-primary'
            : 'rounded-t-xl border-t-4 border-t-primary')
      )}
      ondragover={(e) => s && dragOver(e, s)}
      ondrop={(e) => s && drop(e, s)}
    >
      <SectionCard
        {albumId}
        section={s}
        photos={s ? photosOf(s.id) : []}
        oncreated={(id) => aliases.set(id, item.key)}
        ondelete={() => {
          deleteTarget = s;
          deleteOpen = true;
        }}
        ondragstart={(e) => {
          if (!s) return;
          dragId = s.id;
          e.dataTransfer?.setData('text/plain', s.id);
        }}
        ondragend={endDrag}
      />
    </li>
  {/each}
</ol>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.section_delete_confirm()}
  description={m.section_delete_description()}
  onconfirm={() =>
    deleteTarget && attempt(() => del(`/albums/${albumId}/sections/${deleteTarget?.id}`))}
/>
