<script lang="ts">
import { GALLERY_SIZES, imageUrls } from "$lib/images";
import type { Photo } from "$lib/types";
import { cn } from "$lib/utils";

let {
  photos,
  onopen,
}: {
  photos: Photo[];
  /** Open the album-wide lightbox at this gallery's photo index. */
  onopen: (index: number) => void;
} = $props();
const images = imageUrls();

let loaded = $state<Record<string, boolean>>({});
</script>

<div class="my-8 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
  {#each photos as p, i (p.id)}
    <a
      href={images.src(p.filename, 1920)}
      class="relative block aspect-square overflow-hidden rounded-lg bg-muted"
      onclick={(e) => {
        e.preventDefault();
        onopen(i);
      }}
    >
      <div
        class={cn(
          'absolute inset-0 scale-110 bg-cover blur-xl transition-opacity duration-300',
          loaded[p.id] && 'opacity-0'
        )}
        style:background-image="url({p.placeholder})"
      ></div>
      <img
        loading="lazy"
        alt={p.caption ?? ''}
        src={images.src(p.filename, 800)}
        srcset={images.srcset(p.filename)}
        sizes={GALLERY_SIZES}
        width={p.width}
        height={p.height}
        class="relative block size-full object-cover"
        onload={() => (loaded[p.id] = true)}
      >
    </a>
  {/each}
</div>
