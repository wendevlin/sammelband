<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Expand from "@lucide/svelte/icons/expand";
import ImageIcon from "@lucide/svelte/icons/image";
import type { SourceAccount, SourceImage, SourceListing } from "@sammelband/shared";
import { SvelteMap } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import { api, post } from "$lib/api";
import SourceCrumbs from "$lib/components/app/source-crumbs.svelte";
import SourceFolders from "$lib/components/app/source-folders.svelte";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { errorText } from "$lib/i18n";
import { m } from "$lib/paraglide/messages.js";
import { thumbnailUrl } from "$lib/sources";
import { cn } from "$lib/utils";
import { dragSelect } from "./drag-select";
import { pickerMemory } from "./picker-memory";
import SourceLightbox from "./source-lightbox.svelte";

/**
 * Pick photos in a source account (Nextcloud): folders to browse, photos to
 * select, across folders; by click, by dragging over them, or with shift for
 * a range. Each photo can be looked at full screen first. It opens in the
 * folder it was in while this album is being edited, else in the account's
 * start folder. "Add" imports the selection, a few photos per request so
 * progress shows.
 */
let {
  open = $bindable(false),
  account,
  title,
  ensureSection,
}: {
  open?: boolean;
  account: SourceAccount;
  /** The account's name in menus, e.g. "Nextcloud" or "Work". */
  title: string;
  ensureSection: () => Promise<string | null>;
} = $props();

const BATCH = 10;
const memory = pickerMemory();

let listing = $state<SourceListing | null>(null);
let loading = $state(false);
let problem = $state<string | null>(null);
const selected = new SvelteMap<string, SourceImage>();
let importing = $state<{ done: number; count: number } | null>(null);
/** The last photo clicked, where a shift-click range starts. */
let anchor: string | null = null;
let viewing = $state<number | null>(null);
let scroller = $state<HTMLElement | null>(null);

async function show(location?: string) {
  loading = true;
  problem = null;
  try {
    const query = location === undefined ? "" : `?${new URLSearchParams({ location })}`;
    listing = await api<SourceListing>(`/sources/accounts/${account.id}/browse${query}`);
    memory.set(account.id, listing.location);
    anchor = null;
    scroller?.scrollTo({ top: 0 });
  } catch (err) {
    // The remembered folder is gone: start over in the start folder.
    if (location !== undefined && location === memory.get(account.id)) {
      memory.forget(account.id);
      return show();
    }
    problem = errorText(err);
  } finally {
    loading = false;
  }
}

// Each time it opens: no selection, in the folder from before (this album) or the start folder.
$effect(() => {
  if (!open) return;
  selected.clear();
  listing = null;
  viewing = null;
  void show(memory.get(account.id));
});

const images = $derived(listing?.images ?? []);
const previews = $derived(images.filter((i) => i.thumb));

function select(image: SourceImage, on: boolean) {
  if (on) selected.set(image.ref, image);
  else selected.delete(image.ref);
}

function toggle(image: SourceImage, range = false) {
  const from = range && anchor ? images.findIndex((i) => i.ref === anchor) : -1;
  const to = images.indexOf(image);
  if (from >= 0 && to >= 0) {
    // Shift-click: the range takes the state of the photo it started at.
    const on = selected.has(anchor as string);
    for (const i of images.slice(Math.min(from, to), Math.max(from, to) + 1)) select(i, on);
  } else select(image, !selected.has(image.ref));
  anchor = image.ref;
}

function view(image: SourceImage) {
  viewing = previews.indexOf(image);
}

const drag = dragSelect({
  isSelected: (ref) => selected.has(ref),
  set: (ref, on) => {
    const image = images.find((i) => i.ref === ref);
    if (image) select(image, on);
  },
});

const allHere = $derived(images.length > 0 && images.every((i) => selected.has(i.ref)));
function toggleAll() {
  for (const i of images) select(i, !allHere);
}

const finePointer =
  typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;

async function add() {
  const refs = [...selected.keys()];
  if (refs.length === 0) return;
  importing = { done: 0, count: refs.length };
  let failed = 0;
  let lastError: unknown = null;
  let added = 0;
  try {
    const sectionId = await ensureSection();
    if (!sectionId) return;
    for (let i = 0; i < refs.length; i += BATCH) {
      const batch = refs.slice(i, i + BATCH);
      try {
        await post(`/sections/${sectionId}/import`, { account: account.id, refs: batch });
        added += batch.length;
      } catch (err) {
        failed += batch.length;
        lastError = err;
      }
      importing = { done: Math.min(i + BATCH, refs.length), count: refs.length };
    }
  } finally {
    importing = null;
  }
  if (added > 0)
    toast.success(added === 1 ? m.upload_done_one() : m.upload_done_other({ count: added }));
  if (failed > 0) toast.error(m.picker_failed({ count: failed, reason: errorText(lastError) }));
  if (failed === 0) open = false;
}
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="flex h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-3 p-4 sm:max-w-[min(96vw,112rem)] sm:gap-4 sm:p-6"
  >
    <Dialog.Header class="pr-10">
      <Dialog.Title>{m.picker_title({ source: title })}</Dialog.Title>
      {#if listing}
        <SourceCrumbs crumbs={listing.crumbs} top={title} onopen={show} />
      {/if}
    </Dialog.Header>

    <div
      bind:this={scroller}
      {@attach drag}
      class={cn(
				'relative -mx-1 min-h-0 flex-1 touch-pan-y overflow-y-auto px-1 pb-1 select-none',
				loading && 'opacity-60'
			)}
    >
      {#if problem}
        <p class="py-10 text-center text-sm text-destructive">{problem}</p>
      {:else if listing}
        {#if listing.folders.length > 0}
          <div class="mb-4" data-no-drag-select>
            <SourceFolders folders={listing.folders} onopen={show} />
          </div>
        {/if}
        {#if images.length > 0}
          <div class="mb-2 flex items-center justify-between gap-2" data-no-drag-select>
            <p class="min-w-0 text-sm text-muted-foreground">
              {images.length === 1
                ? m.picker_photos_here_one()
                : m.picker_photos_here_other({ count: images.length })}
              <span class="hidden md:inline">
                · {finePointer ? m.picker_drag_hint() : m.picker_drag_hint_touch()}
              </span>
            </p>
            <Button variant="ghost" size="sm" onclick={toggleAll}>
              {allHere ? m.picker_select_none() : m.picker_select_all()}
            </Button>
          </div>
          <ul
            class="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] sm:gap-2"
          >
            {#each images as image (image.ref)}
              <li class="group relative [-webkit-touch-callout:none]" data-select-key={image.ref}>
                <button
                  type="button"
                  class={cn(
										'relative block aspect-square w-full overflow-hidden rounded-md bg-muted outline-offset-2 transition-[outline-width]',
										selected.has(image.ref) && 'outline-3 outline-primary'
									)}
                  aria-pressed={selected.has(image.ref)}
                  aria-label={image.name}
                  title={image.name}
                  onclick={(e) => toggle(image, e.shiftKey)}
                >
                  {#if image.thumb}
                    <img
                      src={thumbnailUrl(account.id, image.thumb)}
                      alt=""
                      loading="lazy"
                      draggable="false"
                      class={cn(
												'size-full object-cover transition-transform',
												selected.has(image.ref) && 'scale-95 rounded-sm'
											)}
                    >
                  {:else}
                    <span class="flex size-full items-center justify-center text-muted-foreground">
                      <ImageIcon class="size-6" />
                    </span>
                  {/if}
                  {#if selected.has(image.ref)}
                    <span
                      class="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
                    >
                      <Check class="size-4" />
                    </span>
                  {/if}
                </button>
                {#if image.thumb}
                  <!-- Always there on touch screens, on hover with a mouse. -->
                  <button
                    type="button"
                    data-no-drag-select
                    class="absolute right-1.5 bottom-1.5 flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow transition-opacity group-hover:opacity-100 after:absolute after:-inset-1.5 hover:bg-black/75 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(hover:hover)_and_(pointer:fine)]:size-7 [@media(hover:hover)_and_(pointer:fine)]:opacity-0"
                    aria-label={m.picker_view({ name: image.name })}
                    title={m.picker_view({ name: image.name })}
                    onclick={() => view(image)}
                  >
                    <Expand class="size-4" />
                  </button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if listing.folders.length === 0 && images.length === 0}
          <p class="py-10 text-center text-sm text-muted-foreground">{m.picker_empty()}</p>
        {/if}
      {/if}
    </div>

    <!-- The count is always there (also at 0), so nothing moves when it changes. -->
    <div class="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {#if importing}
          {m.picker_importing({ done: importing.done, count: importing.count })}
        {:else}
          {selected.size === 1 ? m.picker_selected_one() : m.picker_selected_other({ count: selected.size })}
        {/if}
      </p>
      <div class="flex gap-2 *:flex-1 sm:*:flex-none">
        <Button variant="outline" onclick={() => (open = false)} disabled={importing !== null}>
          {m.common_cancel()}
        </Button>
        <Button onclick={add} disabled={selected.size === 0 || importing !== null}>
          {selected.size === 0
            ? m.picker_add()
            : selected.size === 1
              ? m.picker_add_one()
              : m.picker_add_other({ count: selected.size })}
        </Button>
      </div>
    </div>

    <!-- Inside the dialog, so it's a layer on top of it (Escape closes it first). -->
    <SourceLightbox
      bind:index={viewing}
      images={previews}
      account={account.id}
      isSelected={(image) => selected.has(image.ref)}
      ontoggle={(image) => select(image, !selected.has(image.ref))}
    />
  </Dialog.Content>
</Dialog.Root>
