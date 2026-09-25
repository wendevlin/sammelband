import PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";
import { css, html, LitElement, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { ApiError, api } from "../api";
import type { GroupBackground } from "../components/sb-block-group";
import { ws } from "../store/ws";
import {
  type AlbumBlock,
  type AlbumDetail,
  fullSrc,
  type Photo,
  srcset,
} from "../types";
import "../components/sb-block-gallery";
import "../components/sb-block-group";

// One slide per album image, in document order — the album-wide lightbox sequence.
type Slide = {
  src: string;
  srcset: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
};

@customElement("sb-album-view")
export class SbAlbumView extends LitElement {
  static override styles = css`
    h1 {
      margin: 0 0 var(--wa-space-xs);
    }
    .desc {
      color: var(--wa-color-text-quiet);
      margin-bottom: var(--wa-space-l);
    }
    .block {
      margin: var(--wa-space-l) 0;
    }
    .heading-1 {
      font-size: var(--wa-font-size-2xl);
      font-weight: var(--wa-font-weight-bold);
    }
    .heading-2 {
      font-size: var(--wa-font-size-xl);
      font-weight: var(--wa-font-weight-semibold);
    }
    .heading-3 {
      font-size: var(--wa-font-size-l);
      font-weight: var(--wa-font-weight-semibold);
    }
    .text {
      max-width: 65ch;
      line-height: var(--wa-line-height-normal);
    }
    .empty {
      color: var(--wa-color-text-quiet);
      padding: var(--wa-space-l) 0;
    }
  `;

  @property({ type: String }) albumId = "";
  /** When provided, render this payload directly (used by share-view). */
  @property({ attribute: false }) detail: AlbumDetail | null = null;

  @state() private loaded: AlbumDetail | null = null;
  @state() private error: string | null = null;
  private wsUnsub: (() => void) | null = null;

  // Single lightbox spanning every gallery in the album (built fresh each render).
  private slides: Slide[] = [];
  private lightbox?: PhotoSwipeLightbox;
  private readonly onOpen = (e: Event) => {
    const index = (e as CustomEvent<{ index: number }>).detail.index;
    this.openLightbox(index);
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("pswp-open", this.onOpen);
    if (this.albumId) {
      void this.load();
      this.wsUnsub = ws.subscribe(`album:${this.albumId}`, () => this.load());
    }
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("albumId") && this.albumId) {
      this.wsUnsub?.();
      this.wsUnsub = ws.subscribe(`album:${this.albumId}`, () => this.load());
      void this.load();
    }
  }

  override disconnectedCallback(): void {
    this.removeEventListener("pswp-open", this.onOpen);
    this.wsUnsub?.();
    this.wsUnsub = null;
    this.lightbox?.destroy();
    this.lightbox = undefined;
    super.disconnectedCallback();
  }

  private openLightbox(index: number) {
    if (!this.lightbox) {
      // loop:false so reaching the album's very last image stops rather than
      // wrapping; within the album it flows from one gallery into the next.
      this.lightbox = new PhotoSwipeLightbox({
        loop: false,
        pswpModule: () => import("photoswipe"),
      });
      this.lightbox.on("uiRegister", () => {
        this.lightbox?.pswp?.ui?.registerElement({
          name: "sb-caption",
          order: 9,
          isButton: false,
          appendTo: "root",
          onInit: (el, pswp) => {
            el.className = "pswp-caption";
            const update = () => {
              const caption =
                (pswp.currSlide?.data as { caption?: string })?.caption ?? "";
              el.textContent = caption;
              el.style.display = caption ? "" : "none";
            };
            pswp.on("change", update);
            update();
          },
        });
      });
      this.lightbox.init();
    }
    this.lightbox.loadAndOpen(index, this.slides);
  }

  // Build the flat slide sequence (and a blockId → start-index map) in the same
  // document order the blocks render in, so per-gallery indices line up.
  private buildSlides(
    blocks: AlbumBlock[],
    photos: Photo[],
  ): Map<string, number> {
    const offsets = new Map<string, number>();
    const slides: Slide[] = [];
    const addGallery = (block: AlbumBlock) => {
      offsets.set(block.id, slides.length);
      for (const p of photos
        .filter((p) => p.block_id === block.id)
        .sort((a, b) => a.sort_order - b.sort_order)) {
        slides.push({
          src: fullSrc(p.filename),
          srcset: srcset(p.filename),
          width: p.width,
          height: p.height,
          alt: p.caption ?? "",
          caption: p.caption ?? "",
        });
      }
    };
    for (const b of blocks.filter((b) => !b.parent_id)) {
      if (b.type === "gallery") addGallery(b);
      else if (b.type === "group") {
        for (const c of blocks
          .filter((c) => c.parent_id === b.id)
          .sort((a, b) => a.sort_order - b.sort_order)) {
          if (c.type === "gallery") addGallery(c);
        }
      }
    }
    this.slides = slides;
    return offsets;
  }

  private async load() {
    try {
      this.loaded = await api<AlbumDetail>(`/albums/${this.albumId}`);
      this.error = null;
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : "Failed to load";
    }
  }

  override render() {
    const detail = this.detail ?? this.loaded;
    if (this.error) {
      return html`<wa-callout variant="danger">${this.error}</wa-callout>`;
    }
    if (!detail) {
      return html`<wa-spinner></wa-spinner>`;
    }

    const { album, blocks, photos } = detail;
    this.galleryOffsets = this.buildSlides(blocks, photos);
    return html`
      <h1>${album.title}</h1>
      ${album.description
        ? html`<p class="desc">${album.description}</p>`
        : null}
      ${blocks.length === 0 && photos.length === 0
        ? html`<p class="empty">This album is empty.</p>`
        : null}
      ${blocks
        .filter((b) => !b.parent_id)
        .map((b) => this.renderBlock(b, blocks, photos))}
    `;
  }

  private galleryOffsets = new Map<string, number>();

  private renderBlock(
    block: AlbumBlock,
    allBlocks: AlbumBlock[],
    allPhotos: Photo[],
  ): TemplateResult | null {
    let content: unknown;
    try {
      content = JSON.parse(block.content);
    } catch {
      return null;
    }
    if (block.type === "group") {
      const { background = "none" } = content as {
        background?: GroupBackground;
      };
      const children = allBlocks
        .filter((b) => b.parent_id === block.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      // Photos owned by gallery children — used to derive the "auto" bg.
      const childIds = new Set(children.map((c) => c.id));
      const galleryPhotos = allPhotos.filter(
        (p) => p.block_id && childIds.has(p.block_id),
      );
      return html`
        <sb-block-group
          class="block"
          .background=${background}
          .photos=${galleryPhotos}
        >
          ${children.map((c) => this.renderBlock(c, allBlocks, allPhotos))}
        </sb-block-group>
      `;
    }
    if (block.type === "heading") {
      const { level = 2, text = "" } = content as {
        level?: number;
        text?: string;
      };
      const cls = `heading-${Math.min(Math.max(level, 1), 3)}`;
      return html`<div class="block ${cls}">${text}</div>`;
    }
    if (block.type === "text") {
      const { markdown = "" } = content as { markdown?: string };
      // Minimal viewer: render newlines as paragraphs. Real markdown lands in editor work.
      const html_ = markdown
        .split(/\n\n+/)
        .map((p) => `<p>${escapeHTML(p)}</p>`)
        .join("");
      return html`<div class="block text">${unsafeHTML(html_)}</div>`;
    }
    if (block.type === "gallery") {
      const { layout = "grid" } = content as {
        layout?: "grid" | "masonry" | "strip";
      };
      const photos = allPhotos
        .filter((p) => p.block_id === block.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      if (photos.length === 0) return null;
      return html`
        <div class="block">
          <sb-block-gallery
            .photos=${photos}
            .layout=${layout}
            .startIndex=${this.galleryOffsets.get(block.id) ?? 0}
          ></sb-block-gallery>
        </div>
      `;
    }
    return null;
  }
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
