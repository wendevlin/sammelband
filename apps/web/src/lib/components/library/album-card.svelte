<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import ImageIcon from "@lucide/svelte/icons/image";
import type { Album } from "@sammelband/shared";
import type { Snippet } from "svelte";
import { Button } from "#lib/components/ui/button/index.ts";
import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.ts";
import { imageUrls } from "#lib/images.ts";
import { albumPath } from "#lib/links.ts";
import { m } from "#lib/paraglide/messages.js";

type CardAlbum = Pick<Album, "title" | "short_id"> & {
  cover_filename?: string | null;
  slug?: string;
};

/**
 * An album in the library grid; links to the album unless `href` says
 * otherwise (public link pages). `menu` adds a "⋯" menu next to the title.
 */
let {
  album,
  href = albumPath({ slug: album.slug ?? "", short_id: album.short_id }),
  menu,
}: { album: CardAlbum; href?: string; menu?: Snippet } = $props();
const images = imageUrls();
</script>

<div class="group">
  <a {href} class="block" draggable="false">
    <div class="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
      {#if album.cover_filename}
        <img
          src={images.src(album.cover_filename, 800)}
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
    <a {href} class="min-w-0 flex-1" draggable="false">
      <h3 class="font-heading text-lg leading-snug group-hover:underline">{album.title}</h3>
    </a>
    {#if menu}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({
            props,
          })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label={m.album_actions()}>
              <EllipsisVertical />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">{@render menu()}</DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
  </div>
</div>
