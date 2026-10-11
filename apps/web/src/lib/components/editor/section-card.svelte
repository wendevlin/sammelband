<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import GripVertical from "@lucide/svelte/icons/grip-vertical";
import Trash from "@lucide/svelte/icons/trash-2";
import type { Photo, Section } from "@sammelband/shared";
import { onDestroy } from "svelte";
import { getAlbumState } from "#lib/album-state.svelte.ts";
import { ApiError, del, patch, post } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Switch } from "#lib/components/ui/switch/index.ts";
import { plainText } from "#lib/markdown.ts";
import { m } from "#lib/paraglide/messages.js";
import { cn } from "#lib/utils.ts";
import GalleryPhotos from "./gallery-photos.svelte";
import MarkdownEditor from "./markdown-editor.svelte";
import { type TouchDragOptions, touchDrag } from "./touch-drag";

type Fields = { title: string; text: string; highlight: boolean };

/**
 * One section in the editor: title, text, highlight and photos, saved as you
 * type. Without `section` it's an empty section (at the end, or inserted
 * between others), which exists only here until its first input or upload
 * creates it.
 */
let {
  albumId,
  section,
  photos,
  anchor,
  focusTitle = 0,
  collapsed = false,
  ontogglecollapse,
  oncreated,
  ondelete,
  ondiscard,
  ondragstart,
  ondragend,
  touch,
}: {
  albumId: string;
  section: Section | null;
  photos: Photo[];
  /** For an inserted empty section: the section it's created before (asked then). */
  anchor?: () => string | null;
  /** Focuses the title on mount and whenever it changes (0: never). */
  focusTitle?: number;
  /** Only the header and a one-line summary are shown (the editor keeps this per session). */
  collapsed?: boolean;
  /** Collapses or expands the section (and gives it the button for that). */
  ontogglecollapse?: () => void;
  /** The empty section was just created with this id. */
  oncreated?: (id: string) => void;
  ondelete?: () => void;
  /** Removes the empty section without saving anything (and gives it a delete button). */
  ondiscard?: () => void;
  ondragstart?: (e: DragEvent) => void;
  ondragend?: () => void;
  /** Moving the section with a finger: press and hold the grip, then drag. */
  touch?: Omit<TouchDragOptions, "preview">;
} = $props();

// --- Autosave ----------------------------------------------------------------
// Unsaved edits live in `edits` and win over `section`. Saved rows go into the
// album state right away, without waiting for their live update.
const live = getAlbumState();
const SAVE_DELAY_MS = 700;
let edits = $state<Partial<Fields>>({});
let saving = $state(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let createdId = $state<string | null>(null);
let creating: Promise<string | null> | null = null;
// Removed before it was created: nothing may be saved from here on.
let discarded = false;

const sectionId = $derived(section?.id ?? createdId);
const highlightId = $props.id();
const bodyId = `${highlightId}-body`;
const value = <K extends keyof Fields>(key: K, fallback: Fields[K]): Fields[K] =>
  (edits[key] ?? section?.[key] ?? fallback) as Fields[K];
const title = $derived(value("title", ""));
const text = $derived(value("text", ""));
const highlight = $derived(value("highlight", false));

/** The section's id, creating it (once) with `fields` if it doesn't exist yet. */
function ensureId(fields: Partial<Fields> = {}): Promise<string | null> {
  if (sectionId) return Promise.resolve(sectionId);
  if (discarded) return Promise.resolve(null);
  creating ??= (async () => {
    const created = await attempt(() => create(fields));
    if (!created || discarded) {
      creating = null;
      // Removed while it was being created: take that back.
      if (created) void attempt(() => del(`/albums/${albumId}/sections/${created.id}`));
      return null;
    }
    createdId = created.id;
    live.apply({ sections: [created] });
    oncreated?.(created.id);
    return created.id;
  })();
  return creating;
}

/**
 * Create the section, before its anchor if it has one. An anchor that was
 * deleted elsewhere just now is skipped: the section goes before the one that
 * replaced it here (once the live update has arrived), or else at the end.
 */
async function create(fields: Partial<Fields>): Promise<Section> {
  const gone = new Set<string>();
  for (;;) {
    const next = anchor?.();
    const beforeId = next && !gone.has(next) ? next : undefined;
    try {
      return await post<Section>(`/albums/${albumId}/sections`, { ...fields, beforeId });
    } catch (e) {
      if (!beforeId || !(e instanceof ApiError && e.code === "anchor_section_not_found")) throw e;
      gone.add(beforeId);
    }
  }
}

function discard() {
  discarded = true;
  clearTimeout(timer);
  timer = undefined;
  ondiscard?.();
}

function change(fields: Partial<Fields>, delay = SAVE_DELAY_MS) {
  if (discarded) return;
  edits = { ...edits, ...fields };
  clearTimeout(timer);
  // The first input creates the section right away, so the next empty one appears.
  timer = setTimeout(() => void save(), sectionId || creating ? delay : 0);
}

/** Save now instead of waiting for the pause (leaving a field, leaving the page). */
function flush() {
  if (timer === undefined) return;
  void save();
}

async function save() {
  clearTimeout(timer);
  timer = undefined;
  if (discarded) return;
  const sent = edits;
  if (Object.keys(sent).length === 0) return;
  saving = true;
  let ok: boolean;
  const id = sectionId ?? (creating ? await creating : null);
  if (id) {
    const updated = await attempt(() => patch<Section>(`/albums/${albumId}/sections/${id}`, sent));
    ok = updated !== undefined;
    if (updated) live.apply({ sections: [updated] });
  } else {
    ok = (await ensureId(sent)) !== null;
  }
  saving = false;
  if (!ok) return;
  // Keep what was typed while this save was in flight.
  const rest = { ...edits };
  for (const key of Object.keys(sent) as (keyof Fields)[]) {
    if (rest[key] === sent[key]) delete rest[key];
  }
  edits = rest;
}

onDestroy(flush);

let titleInput = $state<HTMLInputElement | null>(null);
$effect(() => {
  if (focusTitle) titleInput?.focus();
});

const pending = $derived(saving || Object.keys(edits).length > 0);

/** What follows the finger while the section is moved by touch: a small card with its title. */
function dragPreview(): HTMLElement {
  const card = document.createElement("div");
  card.className =
    "max-w-[min(85vw,28rem)] truncate rounded-xl border bg-card px-4 py-3 font-heading text-xl shadow-lg";
  card.textContent = title.trim() || summary;
  return card;
}

/** What a collapsed section holds: its photo count and the start of its text. */
const summary = $derived.by(() => {
  const parts = [
    photos.length === 0
      ? ""
      : photos.length === 1
        ? m.section_photos_one()
        : m.section_photos_other({ count: photos.length }),
    plainText(text).slice(0, 200),
  ].filter(Boolean);
  return parts.join(" · ") || m.section_collapsed_empty();
});
</script>

<div
  class={cn(
    "rounded-xl border p-4 transition-colors",
    highlight ? "border-highlight-border bg-highlight" : "bg-card",
    !section && !createdId && "border-dashed bg-transparent",
  )}
>
  <div class={cn("flex items-center gap-2", !collapsed && "mb-3")}>
    {#if ontogglecollapse}
      <button
        type="button"
        class="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        aria-label={collapsed ? m.section_expand() : m.section_collapse()}
        title={collapsed ? m.section_expand() : m.section_collapse()}
        onclick={ontogglecollapse}
      >
        <ChevronDown class={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
      </button>
    {/if}
    {#if section}
      <button
        type="button"
        aria-label={m.section_drag()}
        class="relative cursor-grab text-muted-foreground after:absolute after:-inset-2"
        draggable="true"
        {ondragstart}
        {ondragend}
        {@attach touchDrag({
          onstart: () => touch?.onstart(),
          onmove: (x, y) => touch?.onmove(x, y),
          onend: (dropped) => touch?.onend(dropped),
          preview: dragPreview,
        })}
      >
        <GripVertical class="size-4" />
      </button>
    {/if}
    <Input
      bind:ref={titleInput}
      class="h-9 flex-1 border-transparent bg-transparent px-2 font-heading text-xl shadow-none md:text-xl focus-visible:border-input dark:bg-transparent"
      placeholder={m.section_title_placeholder()}
      aria-label={m.section_title_placeholder()}
      maxlength={500}
      value={title}
      oninput={(e) => change({ title: e.currentTarget.value })}
      onblur={flush}
    />
    {#if pending}
      <span class="text-xs text-muted-foreground">{m.common_saving()}</span>
    {/if}
    <div class="flex items-center gap-2 text-sm text-muted-foreground">
      <Switch
        id={highlightId}
        aria-label={m.section_highlight()}
        checked={highlight}
        onCheckedChange={(checked) => change({ highlight: checked }, 0)}
      />
      <label for={highlightId} class="hidden sm:inline">{m.section_highlight()}</label>
    </div>
    {#if section}
      <Button variant="ghost" size="icon-sm" aria-label={m.section_delete()} onclick={ondelete}>
        <Trash />
      </Button>
    {:else if ondiscard && !createdId}
      <Button variant="ghost" size="icon-sm" aria-label={m.section_delete()} onclick={discard}>
        <Trash />
      </Button>
    {/if}
  </div>

  <div id={bodyId}>
    {#if collapsed}
      <button
        type="button"
        class="mt-1 block w-full truncate rounded-sm px-2 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        title={m.section_expand()}
        onclick={ontogglecollapse}
      >
        {summary}
      </button>
    {:else}
      <MarkdownEditor
        placeholder={section || createdId ? m.section_text_placeholder() : m.section_new()}
        value={text}
        onchange={(markdown) => change({ text: markdown })}
        onblur={flush}
      />

      <div class="mt-3">
        <GalleryPhotos {sectionId} {photos} ensureSection={() => ensureId()} />
      </div>
    {/if}
  </div>
</div>
