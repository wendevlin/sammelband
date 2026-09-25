<script lang="ts">
import ImageIcon from "@lucide/svelte/icons/image";
import { imageSrc } from "$lib/images";
import type { Album } from "$lib/types";

let { album }: { album: Album } = $props();
</script>

<a href="/albums/{album.id}" class="group block">
  <div class="relative aspect-[4/3] overflow-hidden bg-muted">
    {#if album.cover_filename}
      <img
        src={imageSrc(album.cover_filename, 800)}
        alt=""
        loading="lazy"
        class="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      >
    {:else}
      <div class="flex size-full items-center justify-center text-muted-foreground/60">
        <ImageIcon class="size-8" />
      </div>
    {/if}
  </div>
  <div class="pt-3">
    <h3 class="font-heading text-lg leading-snug group-hover:underline">{album.title}</h3>
    {#if album.description}
      <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{album.description}</p>
    {/if}
  </div>
</a>
