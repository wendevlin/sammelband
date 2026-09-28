<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import ImageIcon from "@lucide/svelte/icons/image";
import type { Snippet } from "svelte";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { imageSrc } from "$lib/images";
import { albumPath } from "$lib/links";
import type { Album } from "$lib/types";

/** An album in the library grid. `menu` adds a "⋯" menu next to the title. */
let { album, menu }: { album: Album; menu?: Snippet } = $props();
</script>

<div class="group">
  <a href={albumPath(album)} class="block" draggable="false">
    <div class="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
      {#if album.cover_filename}
        <img
          src={imageSrc(album.cover_filename, 800)}
          alt=""
          loading="lazy"
          draggable="false"
          class="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        >
      {:else}
        <div class="flex size-full items-center justify-center text-muted-foreground/60">
          <ImageIcon class="size-8" />
        </div>
      {/if}
    </div>
  </a>
  <div class="flex items-start gap-2 pt-3">
    <a href={albumPath(album)} class="min-w-0 flex-1" draggable="false">
      <h3 class="font-heading text-lg leading-snug group-hover:underline">{album.title}</h3>
      {#if album.description}
        <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{album.description}</p>
      {/if}
    </a>
    {#if menu}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label="Album actions">
              <EllipsisVertical />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">{@render menu()}</DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>
</div>
