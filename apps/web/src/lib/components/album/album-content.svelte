<script lang="ts">
import type PhotoSwipeLightbox from "photoswipe/lightbox";
import { mount, unmount } from "svelte";
import { m } from "#lib/paraglide/messages.js";
import "photoswipe/style.css";
import type { Photo, Section } from "@sammelband/shared";
import * as Dialog from "#lib/components/ui/dialog/index.ts";
import { imageUrls } from "#lib/images.ts";
import { createLightbox } from "#lib/lightbox.ts";
import { enableVideos, slideOf } from "#lib/lightbox-video.ts";
import { cn } from "#lib/utils.ts";
import MarkdownText from "./markdown-text.svelte";
import SectionGallery from "./section-gallery.svelte";
import SectionSlide from "./section-slide.svelte";

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

const hasWords = (s: Section) => !!(s.title.trim() || s.text.trim());

// One lightbox spanning every section in document order, so swiping flows
// from one gallery into the next. A section with a title or text starts with
// a slide that shows them, so the viewer sees where a new section begins.
// `offsets` maps a section to the slide of its first photo.
type Entry = { kind: "section"; section: Section } | { kind: "photo"; photo: Photo };
const sequence = $derived.by(() => {
  // Built fresh inside the derived and never mutated afterwards: no reactivity needed.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const offsets = new Map<string, number>();
  const slides: Entry[] = [];
  for (const s of shown) {
    if (hasWords(s)) slides.push({ kind: "section", section: s });
    offsets.set(s.id, slides.length);
    for (const photo of photosOf(s.id)) slides.push({ kind: "photo", photo });
  }
  return { offsets, slides };
});

let lightbox: PhotoSwipeLightbox | null = null;

// The section of the current slide, for the title in the top bar and the
// dialog on top of the lightbox that shows the full title and the text. The
// title opens it (it may be cut off), and so does an info button when there is text.
type Slide = { alt?: string; type?: string; sectionId: string; photoId?: string };
const sectionOf = (data: unknown) =>
  shown.find((s) => s.id === (data as Slide | undefined)?.sectionId);
// The slide with the section's title and text (no need for the top bar's).
const isSectionSlide = (data: unknown) => (data as Slide | undefined)?.type === "section";
let pswpRoot = $state<HTMLElement | null>(null);
let infoSection = $state<Section | null>(null);
let infoOpen = $state(false);

// Filled circle with a cut-out "i", in PhotoSwipe's 32px icon style.
const INFO_ICON = {
  isCustomSVG: true,
  inner:
    '<path fill-rule="evenodd" id="sb-icn-info" d="M16 6a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM14.5 10h3v3h-3zM14.5 14.5h3V22h-3z"/>',
  outlineID: "sb-icn-info",
};

function showSection(data: unknown) {
  infoSection = sectionOf(data) ?? null;
  infoOpen = !!infoSection;
}

// The page behind follows the lightbox: the current photo's thumbnail (or
// the section of a text slide) is scrolled into view, so closing lands where
// the viewer left off.
function followSlide(data: unknown) {
  const slide = data as Slide | undefined;
  const selector = slide?.photoId
    ? `[data-photo-id="${CSS.escape(slide.photoId)}"]`
    : slide?.sectionId && `[data-section-id="${CSS.escape(slide.sectionId)}"]`;
  const thumb = selector && document.querySelector(selector);
  if (!thumb) return;
  const { top, bottom } = thumb.getBoundingClientRect();
  if (top >= 0 && bottom <= window.innerHeight) return;
  // Hidden behind the solid backdrop, so no smooth scrolling.
  thumb.scrollIntoView({ block: slide?.photoId ? "center" : "start", behavior: "instant" });
}

// Text slides: a Svelte component mounted into PhotoSwipe's slide element.
// Long text scrolls inside its box, by wheel or by dragging (touch), which
// PhotoSwipe would otherwise take for zooming, panning or closing.
const mounted = new WeakMap<HTMLElement, ReturnType<typeof mount>>();
const scrollBox = (target: EventTarget | null) => {
  const box =
    target instanceof Element ? target.closest<HTMLElement>(".sb-section-slide__box") : null;
  return box && box.scrollHeight > box.clientHeight ? box : null;
};
function enableSectionSlides(lb: PhotoSwipeLightbox) {
  lb.on("contentLoad", (e) => {
    const { content } = e;
    if (content.type !== "section") return;
    e.preventDefault();
    const section = sectionOf(content.data);
    const el = document.createElement("div");
    el.className = "pswp__content";
    if (section) mounted.set(el, mount(SectionSlide, { target: el, props: { section } }));
    content.element = el;
    content.state = "loaded";
  });
  lb.on("contentDestroy", ({ content }) => {
    const component = content.element && mounted.get(content.element);
    if (component) unmount(component);
  });
  lb.on("wheel", (e) => {
    const box = scrollBox(e.originalEvent.target);
    if (!box) return;
    e.preventDefault();
    box.scrollTop += e.originalEvent.deltaY;
  });
  lb.on("pointerDown", (e) => {
    if (e.originalEvent.pointerType !== "mouse" && scrollBox(e.originalEvent.target)) {
      e.preventDefault();
    }
  });
}

function open(index: number) {
  if (!lightbox) {
    lightbox = createLightbox();
    enableVideos(lightbox);
    enableSectionSlides(lightbox);
    lightbox.on("uiRegister", () => {
      const ui = lightbox?.pswp?.ui;
      ui?.registerElement({
        name: "sb-section-title",
        order: 6,
        // A plain button: PhotoSwipe's button class would size it like an icon.
        isButton: false,
        tagName: "button",
        onClick: (_e, _el, pswp) => showSection(pswp.currSlide?.data),
        onInit: (el, pswp) => {
          (el as HTMLButtonElement).type = "button";
          const update = () => {
            const data = pswp.currSlide?.data;
            const title = isSectionSlide(data) ? "" : (sectionOf(data)?.title.trim() ?? "");
            el.textContent = title;
            el.title = title;
          };
          pswp.on("change", update);
          update();
        },
      });
      ui?.registerElement({
        name: "sb-section-info",
        title: m.lightbox_section_text(),
        ariaLabel: m.lightbox_section_text(),
        // After the title, before PhotoSwipe's loading indicator (7).
        order: 6.5,
        isButton: true,
        html: INFO_ICON,
        onClick: (_e, _el, pswp) => showSection(pswp.currSlide?.data),
        onInit: (el, pswp) => {
          const update = () => {
            const data = pswp.currSlide?.data;
            el.style.display = !isSectionSlide(data) && sectionOf(data)?.text.trim() ? "" : "none";
          };
          pswp.on("change", update);
          update();
        },
      });
      ui?.registerElement({
        name: "sb-caption",
        order: 9,
        isButton: false,
        appendTo: "root",
        onInit: (el, pswp) => {
          el.className = "pswp-caption";
          const update = () => {
            const data = pswp.currSlide?.data as Slide | undefined;
            const caption = data?.alt ?? "";
            el.textContent = caption;
            el.style.display = caption ? "" : "none";
            el.classList.toggle("pswp-caption--video", data?.type === "video");
          };
          pswp.on("change", update);
          update();
        },
      });
    });
    // The text dialog lives inside PhotoSwipe's root, so its focus trap keeps
    // working; while it is open, keys and the wheel belong to the dialog.
    lightbox.on("afterInit", () => {
      pswpRoot = lightbox?.pswp?.element ?? null;
    });
    lightbox.on("change", () => followSlide(lightbox?.pswp?.currSlide?.data));
    lightbox.on("keydown", (e) => {
      if (infoOpen) e.preventDefault();
    });
    lightbox.on("destroy", () => {
      infoOpen = false;
      pswpRoot = null;
    });
    lightbox.init();
  }
  lightbox.loadAndOpen(
    index,
    sequence.slides.map((entry) =>
      entry.kind === "section"
        ? { type: "section", sectionId: entry.section.id }
        : {
            ...slideOf(entry.photo, images),
            sectionId: entry.photo.section_id,
            photoId: entry.photo.id,
          },
    ),
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
    <!-- Wider than the text column on large screens (see .bleed). Title and
         text start at its left edge, like the photos, at a readable width. -->
    <section
      data-section-id={s.id}
      class={cn(
        "bleed my-10 first:mt-0",
        s.highlight && "rounded-2xl border border-highlight-border bg-highlight px-5 py-6 sm:px-8",
      )}
    >
      {#if s.title.trim()}
        <h2 class="mb-4 max-w-4xl font-heading text-3xl">{s.title}</h2>
      {/if}
      {#if s.text.trim()}
        <MarkdownText text={s.text} class="mb-6 prose max-w-3xl prose-stone dark:prose-invert" />
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

<Dialog.Root bind:open={infoOpen}>
  {#if pswpRoot && infoSection}
    <Dialog.Content
      portalProps={{ to: pswpRoot }}
      class="flex max-h-[85dvh] flex-col gap-4 sm:max-w-xl"
      onwheel={(e) => e.stopPropagation()}
    >
      <Dialog.Header>
        <!-- Like the section heading on the album page, clear of the close button. -->
        <Dialog.Title
          class={cn(
            "pr-10 text-2xl leading-tight font-normal tracking-normal normal-case",
            !infoSection.title.trim() && "sr-only",
          )}
        >
          {infoSection.title.trim() || m.lightbox_section_text()}
        </Dialog.Title>
      </Dialog.Header>
      {#if infoSection.text.trim()}
        <MarkdownText
          text={infoSection.text}
          class="-mx-1 overflow-y-auto px-1 prose prose-stone dark:prose-invert"
        />
      {/if}
    </Dialog.Content>
  {/if}
</Dialog.Root>
