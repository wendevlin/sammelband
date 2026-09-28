<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import FolderIcon from "@lucide/svelte/icons/folder";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash from "@lucide/svelte/icons/trash-2";
import type { Snippet } from "svelte";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { imageUrls } from "$lib/images";
import { m } from "$lib/paraglide/messages.js";
import type { FolderTile } from "$lib/types";
import { cn } from "$lib/utils";

/**
 * A folder in the library grid, the same size as an album card. Its tile
 * previews up to four album covers; the stacked edges behind it and the
 * folder label tell it apart from an album.
 */
let {
  folder,
  href = `/folders/${folder.id}`,
  onrename,
  ondelete,
  menu,
}: {
  folder: Pick<FolderTile, "id" | "name" | "covers" | "album_count" | "folder_count">;
  href?: string;
  /** Without these the card is read-only (public link pages). */
  onrename?: () => void;
  ondelete?: () => void;
  menu?: Snippet;
} = $props();
const images = imageUrls();

const covers = $derived(folder.covers.slice(0, 4));
// 1: full tile; 2: side by side; 3: one large + two small; 4: 2×2.
const layout = $derived(
  ["", "grid-cols-1", "grid-cols-2", "grid-cols-3 grid-rows-2", "grid-cols-2 grid-rows-2"][
    covers.length
  ],
);
// Sheets peeking out behind the tile hint at how much is inside: none when
// empty, one for a single item, two for more.
const sheets = $derived(Math.min(2, folder.album_count + folder.folder_count));
const summary = $derived(
  [
    folder.album_count > 0 &&
      (folder.album_count === 1
        ? m.count_album_one()
        : m.count_album_other({ count: folder.album_count })),
    folder.folder_count > 0 &&
      (folder.folder_count === 1
        ? m.count_folder_one()
        : m.count_folder_other({ count: folder.folder_count })),
  ]
    .filter(Boolean)
    .join(" · ") || m.folder_empty(),
);
</script>

<div class="group">
  <a
    {href}
    class="relative block pt-3"
    aria-label={m.folder_aria({ name: folder.name })}
    draggable="false"
  >
    {#if sheets >= 2}
      <div
        class="absolute inset-x-8 top-0 h-10 rounded-xl border border-foreground/10 bg-secondary"
      ></div>
    {/if}
    {#if sheets >= 1}
      <div
        class="absolute inset-x-4 top-1.5 h-10 rounded-xl border border-foreground/10 bg-card shadow-sm"
      ></div>
    {/if}
    <div class="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted ring-1 ring-border">
      {#if covers.length === 0}
        <div class="flex size-full items-center justify-center">
          <FolderIcon class="size-12 text-primary/30" strokeWidth={1.25} />
        </div>
      {:else}
        <div class={cn('grid size-full gap-0.5 bg-card', layout)}>
          {#each covers as cover, i (cover)}
            <img
              src={images.src(cover, covers.length === 1 || (covers.length === 3 && i === 0) ? 800 : 400)}
              alt=""
              loading="lazy"
              draggable="false"
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
        {m.folder_badge()}
      </span>
    </div>
  </a>
  <div class="flex items-start gap-2 pt-3">
    <a {href} class="min-w-0 flex-1" draggable="false">
      <h3 class="truncate font-heading text-lg leading-snug group-hover:underline">
        {folder.name}
      </h3>
      <p class="mt-1 text-sm text-muted-foreground">{summary}</p>
    </a>
    {#if onrename && ondelete}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label={m.folder_actions()}>
              <EllipsisVertical />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item onclick={onrename}><Pencil /> {m.common_rename()}</DropdownMenu.Item>
          {@render menu?.()}
          <DropdownMenu.Separator />
          <DropdownMenu.Item variant="destructive" onclick={ondelete}>
            <Trash />
            {m.common_delete()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>
</div>
