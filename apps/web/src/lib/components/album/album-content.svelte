<script lang="ts">
import PhotoSwipeLightbox from "photoswipe/lightbox";
import { m } from "$lib/paraglide/messages.js";
import "photoswipe/style.css";
import type { Photo, Section } from "@sammelband/shared";
import { imageUrls } from "$lib/images";
import { cn } from "$lib/utils";
import SectionGallery from "./section-gallery.svelte";

let { sections, photos }: { sections: Section[]; photos: Photo[] } = $props();
const images = imageUrls();

const bySort = (a: { sort_order: number }, b: { sort_order: number }) =>
  a.sort_order - b.sort_order;

const photosOf = (sectionId: string) =>
  photos.filter((p) => p.section_id === sectionId).sort(bySort);
// Sections with nothing to show (a cleared one, or one being filled in) are skipped.
const shown = $derived(
  [...sections]
    .sort(bySort)
    .filter((s) => s.title.trim() || s.text.trim() || photosOf(s.id).length > 0),
);

// One lightbox spanning every section in document order, so swiping flows
// from one gallery into the next. `offsets` maps a section to its first slide.
const sequence = $derived.by(() => {
  // Built fresh inside the derived and never mutated afterwards: no reactivity needed.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const offsets = new Map<string, number>();
  const slides: Photo[] = [];
  for (const s of shown) {
    offsets.set(s.id, slides.length);
    slides.push(...photosOf(s.id));
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
      src: images.src(p.filename, 1920),
      srcset: images.srcset(p.filename),
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
</script>

{#if shown.length === 0}
  <p class="py-16 text-center text-muted-foreground">{m.album_empty()}</p>
{:else}
  {#each shown as s (s.id)}
    {@const gallery = photosOf(s.id)}
    <section
      class={cn(
        'my-10 first:mt-0',
        s.highlight && 'rounded-2xl border border-highlight-border bg-highlight px-5 py-6 sm:px-8'
      )}
    >
      {#if s.title.trim()}
        <h2 class="mb-4 font-heading text-3xl">{s.title}</h2>
      {/if}
      {#if s.text.trim()}
        <div class="mb-6 prose max-w-none prose-stone dark:prose-invert">
          {#each s.text.split(/\n\n+/).filter((p) => p.trim()) as paragraph, i (i)}
            <p class="whitespace-pre-line">{paragraph}</p>
          {/each}
        </div>
      {/if}
      {#if gallery.length > 0}
        <SectionGallery
          photos={gallery}
          onopen={(i) => open((sequence.offsets.get(s.id) ?? 0) + i)}
        />
      {/if}
    </section>
  {/each}
{/if}
