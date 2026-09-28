<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import FolderIcon from "@lucide/svelte/icons/folder";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash from "@lucide/svelte/icons/trash-2";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { imageSrc } from "$lib/images";
import type { FolderTile } from "$lib/types";
import { cn } from "$lib/utils";

/**
 * A folder in the library grid, the same size as an album card. Its tile
 * previews up to four album covers; the stacked edges behind it and the
 * folder label tell it apart from an album.
 */
let {
  folder,
  onrename,
  ondelete,
}: { folder: FolderTile; onrename: () => void; ondelete: () => void } = $props();

const covers = $derived(folder.covers.slice(0, 4));
// 1: full tile; 2: side by side; 3: one large + two small; 4: 2×2.
const layout = $derived(
  ["", "grid-cols-1", "grid-cols-2", "grid-cols-3 grid-rows-2", "grid-cols-2 grid-rows-2"][
    covers.length
  ],
);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const summary = $derived(
  [
    folder.album_count > 0 && plural(folder.album_count, "album"),
    folder.folder_count > 0 && plural(folder.folder_count, "folder"),
  ]
    .filter(Boolean)
    .join(" · ") || "Empty",
);
</script>

<div class="group">
  <a href="/folders/{folder.id}" class="relative block pt-3" aria-label="Folder {folder.name}">
    <!-- Two sheets peeking out behind the tile: a stack, not a single album. -->
    <div
      class="absolute inset-x-8 top-0 h-10 rounded-xl border border-foreground/10 bg-secondary"
    ></div>
    <div
      class="absolute inset-x-4 top-1.5 h-10 rounded-xl border border-foreground/10 bg-card shadow-sm"
    ></div>
    <div class="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted ring-1 ring-border">
      {#if covers.length === 0}
        <div class="flex size-full items-center justify-center">
          <FolderIcon class="size-12 text-primary/30" strokeWidth={1.25} />
        </div>
      {:else}
        <div class={cn('grid size-full gap-0.5 bg-card', layout)}>
          {#each covers as cover, i (cover)}
            <img
              src={imageSrc(cover, covers.length === 1 || (covers.length === 3 && i === 0) ? 800 : 400)}
              alt=""
              loading="lazy"
              class={cn(
                'size-full min-h-0 object-cover transition-transform duration-500 group-hover:scale-[1.03]',
                covers.length === 3 && i === 0 && 'col-span-2 row-span-2'
              )}
            >
          {/each}
        </div>
      {/if}
      <span
        class="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1 text-xs font-medium backdrop-blur"
      >
        <FolderIcon class="size-3.5" />
        Folder
      </span>
    </div>
  </a>
  <div class="flex items-start gap-2 pt-3">
    <a href="/folders/{folder.id}" class="min-w-0 flex-1">
      <h3 class="truncate font-heading text-lg leading-snug group-hover:underline">
        {folder.name}
      </h3>
      <p class="mt-1 text-sm text-muted-foreground">{summary}</p>
    </a>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" size="icon-sm" aria-label="Folder actions">
            <EllipsisVertical />
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item onclick={onrename}><Pencil /> Rename</DropdownMenu.Item>
        <DropdownMenu.Item variant="destructive" onclick={ondelete}>
          <Trash />
          Delete
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</div>
