<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Folder from "@lucide/svelte/icons/folder";
import ImageIcon from "@lucide/svelte/icons/image";
import type { SourceImage, SourceInfo, SourceListing } from "@sammelband/shared";
import { SvelteMap } from "svelte/reactivity";
import { toast } from "svelte-sonner";
import { api, post } from "$lib/api";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { errorText } from "$lib/i18n";
import { m } from "$lib/paraglide/messages.js";
import { thumbnailUrl } from "$lib/sources";
import { cn } from "$lib/utils";

/**
 * Pick photos in a source (Nextcloud): folders to browse, photos to select,
 * across folders. It opens where the user was last time. "Add" imports the
 * selection into the section, a few photos per request so progress shows.
 */
let {
  open = $bindable(false),
  source,
  ensureSection,
}: {
  open?: boolean;
  source: SourceInfo;
  ensureSection: () => Promise<string | null>;
} = $props();

const BATCH = 10;

let listing = $state<SourceListing | null>(null);
let loading = $state(false);
let problem = $state<string | null>(null);
const selected = new SvelteMap<string, SourceImage>();
let importing = $state<{ done: number; count: number } | null>(null);

async function show(location?: string) {
  loading = true;
  problem = null;
  try {
    const query = location === undefined ? "" : `?${new URLSearchParams({ location })}`;
    listing = await api<SourceListing>(`/sources/${source.id}/browse${query}`);
  } catch (err) {
    problem = errorText(err);
  } finally {
    loading = false;
  }
}

// Each time it opens: start fresh, in the folder from last time.
$effect(() => {
  if (!open) return;
  selected.clear();
  listing = null;
  void show();
});

function toggle(image: SourceImage) {
  if (selected.has(image.ref)) selected.delete(image.ref);
  else selected.set(image.ref, image);
}

const allHere = $derived(
  (listing?.images.length ?? 0) > 0 && (listing?.images.every((i) => selected.has(i.ref)) ?? false),
);
function toggleAll() {
  const images = listing?.images ?? [];
  if (allHere) for (const i of images) selected.delete(i.ref);
  else for (const i of images) selected.set(i.ref, i);
}

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
        await post(`/sections/${sectionId}/import`, { source: source.id, refs: batch });
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

const crumbName = (name: string) => name || source.name;
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[90dvh] flex-col gap-4 sm:max-w-4xl">
    <Dialog.Header>
      <Dialog.Title>{m.picker_title({ source: source.name })}</Dialog.Title>
      {#if listing}
        <nav class="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          {#each listing.crumbs as crumb, i (crumb.ref)}
            {#if i > 0}
              <ChevronRight class="size-3.5" />
            {/if}
            {#if i === listing.crumbs.length - 1}
              <span class="font-medium text-foreground">{crumbName(crumb.name)}</span>
            {:else}
              <button
                type="button"
                class="hover:text-foreground hover:underline"
                onclick={() => show(crumb.ref)}
              >
                {crumbName(crumb.name)}
              </button>
            {/if}
          {/each}
        </nav>
      {/if}
    </Dialog.Header>

    <div class={cn('-mx-1 min-h-48 flex-1 overflow-y-auto px-1', loading && 'opacity-60')}>
      {#if problem}
        <p class="py-10 text-center text-sm text-destructive">{problem}</p>
      {:else if listing}
        {#if listing.folders.length > 0}
          <ul class="mb-4 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {#each listing.folders as folder (folder.ref)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                  onclick={() => show(folder.ref)}
                >
                  <Folder class="size-4 shrink-0 text-muted-foreground" />
                  <span class="truncate">{folder.name}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if listing.images.length > 0}
          <div class="mb-2 flex justify-end">
            <Button variant="ghost" size="sm" onclick={toggleAll}>
              {allHere ? m.picker_select_none() : m.picker_select_all()}
            </Button>
          </div>
          <ul class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {#each listing.images as image (image.ref)}
              <li>
                <button
                  type="button"
                  class={cn(
                    'relative block aspect-square w-full overflow-hidden rounded-md bg-muted outline-offset-2',
                    selected.has(image.ref) && 'outline-3 outline-primary'
                  )}
                  aria-pressed={selected.has(image.ref)}
                  aria-label={image.name}
                  title={image.name}
                  onclick={() => toggle(image)}
                >
                  {#if image.thumb}
                    <img
                      src={thumbnailUrl(source.id, image.thumb)}
                      alt=""
                      loading="lazy"
                      class="size-full object-cover"
                    >
                  {:else}
                    <span class="flex size-full items-center justify-center text-muted-foreground">
                      <ImageIcon class="size-6" />
                    </span>
                  {/if}
                  {#if selected.has(image.ref)}
                    <span
                      class="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    >
                      <Check class="size-3.5" />
                    </span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if listing.folders.length === 0 && listing.images.length === 0}
          <p class="py-10 text-center text-sm text-muted-foreground">{m.picker_empty()}</p>
        {/if}
      {/if}
    </div>

    <Dialog.Footer class="items-center gap-2 sm:justify-between">
      <span class="text-sm text-muted-foreground">
        {#if importing}
          {m.picker_importing({ done: importing.done, count: importing.count })}
        {:else if selected.size > 0}
          {selected.size === 1 ? m.picker_selected_one() : m.picker_selected_other({ count: selected.size })}
        {/if}
      </span>
      <div class="flex gap-2">
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
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
