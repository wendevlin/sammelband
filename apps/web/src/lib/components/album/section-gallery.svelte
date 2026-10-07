<script lang="ts">
import MessageSquareText from "@lucide/svelte/icons/message-square-text";
import { justify, type Photo } from "@sammelband/shared";
import { imageUrls } from "#lib/images.ts";
import { cn } from "#lib/utils.ts";

/**
 * A section's photos in justified rows (like Google Photos): every photo keeps
 * its aspect ratio, rows fill the width, the last row isn't stretched.
 */
let {
  photos,
  onopen,
}: {
  photos: Photo[];
  /** Open the album-wide lightbox at this gallery's photo index. */
  onopen: (index: number) => void;
} = $props();
const images = imageUrls();

const GAP = 8;
let width = $state(0);
const rows = $derived(
  justify(
    photos.map((p) => p.width / p.height),
    // Rows grow with the width (about five across), within bounds.
    { width, targetHeight: Math.min(300, Math.max(170, width / 5)), gap: GAP },
  ),
);

let loaded = $state<Record<string, boolean>>({});
</script>

<div class="flex flex-col" style:gap="{GAP}px" bind:clientWidth={width}>
  {#each rows as row, r (r)}
    <div class="flex" style:gap="{GAP}px" style:height="{row.height}px">
      {#each row.items as item (photos[item.index]?.id)}
        {@const p = photos[item.index]}
        {#if p}
          <a
            href={images.src(p.filename, 1920)}
            data-photo-id={p.id}
            class="relative block min-w-0 shrink overflow-hidden rounded-md bg-muted"
            style:flex="0 1 {item.width}px"
            onclick={(e) => {
              e.preventDefault();
              onopen(item.index);
            }}
          >
            <div
              class={cn(
                "absolute inset-0 scale-110 bg-cover blur-xl transition-opacity duration-300",
                loaded[p.id] && "opacity-0",
              )}
              style:background-image="url({p.placeholder})"
            ></div>
            <img
              loading="lazy"
              alt={p.caption ?? ""}
              src={images.src(p.filename, 800)}
              srcset={images.srcset(p.filename)}
              sizes="{Math.ceil(item.width)}px"
              width={p.width}
              height={p.height}
              class="relative block size-full object-cover"
              onload={() => (loaded[p.id] = true)}
            >
            {#if p.caption?.trim()}
              <!-- The caption is shown in the lightbox; the image's alt text carries it here. -->
              <span
                class="absolute right-1.5 bottom-1.5 rounded-full bg-black/55 p-1 text-white"
                aria-hidden="true"
              >
                <MessageSquareText class="size-3.5" />
              </span>
            {/if}
          </a>
        {/if}
      {/each}
    </div>
  {/each}
</div>
