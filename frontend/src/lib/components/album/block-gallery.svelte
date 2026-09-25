<script lang="ts">
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import { GALLERY_SIZES, imageSrc, srcset } from "$lib/images";
import type { GalleryLayout, Photo } from "$lib/types";
import { cn } from "$lib/utils";

let {
  photos,
  layout = "grid",
  onopen,
}: {
  photos: Photo[];
  layout?: GalleryLayout;
  /** Open the album-wide lightbox at this gallery's photo index. */
  onopen: (index: number) => void;
} = $props();

let strip = $state<HTMLElement | null>(null);
let canLeft = $state(false);
let canRight = $state(false);
let loaded = $state<Record<string, boolean>>({});

function updateScroll() {
  if (!strip) return;
  canLeft = strip.scrollLeft > 1;
  canRight = strip.scrollLeft < strip.scrollWidth - strip.clientWidth - 1;
}

function scrollBy(dir: 1 | -1) {
  strip?.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: "smooth" });
}

$effect(() => {
  if (layout !== "strip") return;
  updateScroll();
  const onResize = () => updateScroll();
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
});

const containerClass = $derived(
  layout === "grid"
    ? "grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
    : layout === "masonry"
      ? "columns-2 gap-2 sm:columns-3 [&>*]:mb-2"
      : "flex snap-x snap-mandatory gap-2 overflow-x-auto [scrollbar-width:thin]",
);
</script>

<div class="relative my-8">
  <div
    bind:this={strip}
    class={containerClass}
    onscroll={layout === 'strip' ? updateScroll : undefined}
  >
    {#each photos as p, i (p.id)}
      <a
        href={imageSrc(p.filename, 1920)}
        class={cn(
					'relative block break-inside-avoid overflow-hidden bg-muted',
					layout === 'grid' && 'aspect-square',
					layout === 'strip' && 'h-[min(60vh,420px)] shrink-0 snap-start'
				)}
        style:aspect-ratio={layout === 'strip' ? `${p.width} / ${p.height}` : undefined}
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
          src={imageSrc(p.filename, 800)}
          srcset={srcset(p.filename)}
          sizes={GALLERY_SIZES}
          width={p.width}
          height={p.height}
          class={cn(
						'relative block w-full',
						layout === 'masonry' ? 'h-auto' : 'h-full object-cover'
					)}
          onload={() => {
						loaded[p.id] = true;
						if (layout === 'strip') updateScroll();
					}}
        >
      </a>
    {/each}
  </div>
  {#if layout === 'strip'}
    {#each [{ dir: -1 as const, show: canLeft }, { dir: 1 as const, show: canRight }] as edge (edge.dir)}
      <button
        type="button"
        aria-label={edge.dir < 0 ? 'Scroll left' : 'Scroll right'}
        class={cn(
					'absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow-md transition-opacity',
					edge.dir < 0 ? 'left-2' : 'right-2',
					edge.show ? 'opacity-90 hover:opacity-100' : 'pointer-events-none opacity-0'
				)}
        onclick={() => scrollBy(edge.dir)}
      >
        {#if edge.dir < 0}
          <ChevronLeft class="size-5" />
        {:else}
          <ChevronRight class="size-5" />
        {/if}
      </button>
    {/each}
  {/if}
</div>
