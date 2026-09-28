<script lang="ts">
import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";
import { imageSrc, srcset } from "$lib/images";
import {
  type AlbumBlock,
  type GalleryContent,
  type GroupContent,
  type HeadingContent,
  type Photo,
  parseContent,
  type TextContent,
} from "$lib/types";
import BlockGallery from "./block-gallery.svelte";
import BlockGroup from "./block-group.svelte";

let { blocks, photos }: { blocks: AlbumBlock[]; photos: Photo[] } = $props();

const bySort = (a: { sort_order: number }, b: { sort_order: number }) =>
  a.sort_order - b.sort_order;

const topLevel = $derived(blocks.filter((b) => !b.parent_id).sort(bySort));
const childrenOf = (id: string) => blocks.filter((b) => b.parent_id === id).sort(bySort);
const photosOf = (blockId: string) => photos.filter((p) => p.block_id === blockId).sort(bySort);

// One lightbox spanning every gallery in document order, so swiping flows
// from one gallery into the next. `offsets` maps a gallery to its first slide.
const sequence = $derived.by(() => {
  // Built fresh inside the derived and never mutated afterwards: no reactivity needed.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const offsets = new Map<string, number>();
  const slides: Photo[] = [];
  const add = (b: AlbumBlock) => {
    if (b.type !== "gallery") return;
    offsets.set(b.id, slides.length);
    slides.push(...photosOf(b.id));
  };
  for (const b of topLevel) {
    if (b.type === "group") childrenOf(b.id).forEach(add);
    else add(b);
  }
  return { offsets, slides };
});

let lightbox: PhotoSwipeLightbox | null = null;

function open(index: number) {
  if (!lightbox) {
    lightbox = new PhotoSwipeLightbox({
      loop: false,
      // Solid backdrop: the page behind would otherwise show through at 0.8.
      bgOpacity: 1,
      pswpModule: () => import("photoswipe"),
    });
    lightbox.on("uiRegister", () => {
      lightbox?.pswp?.ui?.registerElement({
        name: "sb-caption",
        order: 9,
        isButton: false,
        appendTo: "root",
        onInit: (el, pswp) => {
          el.className = "pswp-caption";
          const update = () => {
            const caption = (pswp.currSlide?.data as { alt?: string })?.alt ?? "";
            el.textContent = caption;
            el.style.display = caption ? "" : "none";
          };
          pswp.on("change", update);
          update();
        },
      });
    });
    lightbox.init();
  }
  lightbox.loadAndOpen(
    index,
    sequence.slides.map((p) => ({
      src: imageSrc(p.filename, 1920),
      srcset: srcset(p.filename),
      width: p.width,
      height: p.height,
      alt: p.caption ?? "",
    })),
  );
}

$effect(() => () => {
  lightbox?.destroy();
  lightbox = null;
});

const HEADING_CLASS: Record<number, string> = {
  1: "font-heading mt-14 mb-4 text-4xl",
  2: "font-heading mt-12 mb-3 text-3xl",
  3: "mt-8 mb-2 text-lg font-semibold",
};
</script>

{#snippet block(b: AlbumBlock)}
  {#if b.type === 'heading'}
    {@const c = parseContent<HeadingContent>(b)}
    {@const level = Math.min(Math.max(c.level ?? 2, 1), 3)}
    <svelte:element this={`h${level}`} class={HEADING_CLASS[level]}>{c.text ?? ''}</svelte:element>
  {:else if b.type === 'text'}
    {@const c = parseContent<TextContent>(b)}
    <div class="my-6 prose max-w-none prose-stone dark:prose-invert">
      {#each (c.markdown ?? '').split(/\n\n+/).filter((p) => p.trim()) as paragraph, i (i)}
        <p class="whitespace-pre-line">{paragraph}</p>
      {/each}
    </div>
  {:else if b.type === 'gallery'}
    {@const gallery = photosOf(b.id)}
    {#if gallery.length > 0}
      <BlockGallery
        photos={gallery}
        layout={parseContent<GalleryContent>(b).layout}
        onopen={(i) => open((sequence.offsets.get(b.id) ?? 0) + i)}
      />
    {/if}
  {:else if b.type === 'group'}
    {@const kids = childrenOf(b.id)}
    <BlockGroup
      background={parseContent<GroupContent>(b).background}
      photos={kids.flatMap((k) => photosOf(k.id))}
    >
      {#each kids as kid (kid.id)}
        {@render block(kid)}
      {/each}
    </BlockGroup>
  {/if}
{/snippet}

{#if topLevel.length === 0}
  <p class="py-16 text-center text-muted-foreground">This album is empty.</p>
{:else}
  {#each topLevel as b (b.id)}
    {@render block(b)}
  {/each}
{/if}
