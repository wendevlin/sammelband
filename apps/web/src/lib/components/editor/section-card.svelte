<script lang="ts">
import GripVertical from "@lucide/svelte/icons/grip-vertical";
import Trash from "@lucide/svelte/icons/trash-2";
import type { Photo, Section } from "@sammelband/shared";
import { onDestroy } from "svelte";
import { getAlbumState } from "#lib/album-state.svelte.ts";
import { patch, post } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Switch } from "#lib/components/ui/switch/index.ts";
import { m } from "#lib/paraglide/messages.js";
import { cn } from "#lib/utils.ts";
import GalleryPhotos from "./gallery-photos.svelte";
import MarkdownEditor from "./markdown-editor.svelte";

type Fields = { title: string; text: string; highlight: boolean };

/**
 * One section in the editor: title, text, highlight and photos, saved as you
 * type. Without `section` it's the empty section at the end, which exists
 * only here until its first input or upload creates it.
 */
let {
  albumId,
  section,
  photos,
  oncreated,
  ondelete,
  ondragstart,
  ondragend,
}: {
  albumId: string;
  section: Section | null;
  photos: Photo[];
  /** The empty section was just created with this id. */
  oncreated?: (id: string) => void;
  ondelete?: () => void;
  ondragstart?: (e: DragEvent) => void;
  ondragend?: () => void;
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

const sectionId = $derived(section?.id ?? createdId);
const highlightId = $props.id();
const value = <K extends keyof Fields>(key: K, fallback: Fields[K]): Fields[K] =>
  (edits[key] ?? section?.[key] ?? fallback) as Fields[K];
const title = $derived(value("title", ""));
const text = $derived(value("text", ""));
const highlight = $derived(value("highlight", false));

/** The section's id, creating it (once) with `fields` if it doesn't exist yet. */
function ensureId(fields: Partial<Fields> = {}): Promise<string | null> {
  if (sectionId) return Promise.resolve(sectionId);
  creating ??= (async () => {
    const created = await attempt(() => post<Section>(`/albums/${albumId}/sections`, fields));
    if (!created) {
      creating = null;
      return null;
    }
    createdId = created.id;
    live.apply({ sections: [created] });
    oncreated?.(created.id);
    return created.id;
  })();
  return creating;
}

function change(fields: Partial<Fields>, delay = SAVE_DELAY_MS) {
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

const pending = $derived(saving || Object.keys(edits).length > 0);
</script>

<div
  class={cn(
    "rounded-xl border p-4 transition-colors",
    highlight ? "border-highlight-border bg-highlight" : "bg-card",
    !section && !createdId && "border-dashed bg-transparent",
  )}
>
  <div class="mb-3 flex items-center gap-2">
    {#if section}
      <button
        type="button"
        aria-label={m.section_drag()}
        class="cursor-grab text-muted-foreground"
        draggable="true"
        {ondragstart}
        {ondragend}
      >
        <GripVertical class="size-4" />
      </button>
    {/if}
    <Input
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
    {/if}
  </div>

  <MarkdownEditor
    placeholder={section || createdId ? m.section_text_placeholder() : m.section_new()}
    value={text}
    onchange={(markdown) => change({ text: markdown })}
    onblur={flush}
  />

  <div class="mt-3">
    <GalleryPhotos {sectionId} {photos} ensureSection={() => ensureId()} />
  </div>
</div>
