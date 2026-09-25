import { css, html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { fullSrc, type Photo, sizesAttr, srcset } from "../types";

type Layout = "grid" | "masonry" | "strip";

@customElement("sb-block-gallery")
export class SbBlockGallery extends LitElement {
  static override styles = css`
    :host {
      display: block;
      margin: var(--wa-space-m) 0;
    }
    .gallery {
      display: grid;
      gap: var(--wa-space-xs);
    }
    .gallery[data-layout="grid"] {
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    }
    .gallery[data-layout="masonry"] {
      column-count: 3;
      column-gap: var(--wa-space-xs);
      display: block;
    }
    .gallery[data-layout="masonry"] .tile {
      break-inside: avoid;
      margin-bottom: var(--wa-space-xs);
    }
    .gallery[data-layout="strip"] {
      grid-auto-flow: column;
      /* Filmstrip: fixed height, each image keeps its natural width. */
      grid-auto-columns: max-content;
      overflow-x: auto;
      scroll-snap-type: x mandatory;
      scrollbar-width: thin;
    }
    .gallery[data-layout="strip"] .tile {
      height: min(60vh, 420px);
    }
    .gallery[data-layout="strip"] .tile img {
      width: auto;
      height: 100%;
    }
    .tile {
      position: relative;
      border-radius: var(--wa-border-radius-m);
      overflow: hidden;
      background: #eee;
      scroll-snap-align: start;
    }
    .tile img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    /* Horizontal scroll affordance for the strip layout. */
    .gallery-wrap {
      position: relative;
    }
    .edge {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: var(--wa-color-surface-raised);
      color: var(--wa-color-text-normal);
      box-shadow: var(--wa-shadow-m);
      display: grid;
      place-items: center;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms;
      z-index: 1;
    }
    .edge.show {
      opacity: 0.9;
      pointer-events: auto;
    }
    .edge:hover {
      opacity: 1;
    }
    .edge-left {
      left: var(--wa-space-xs);
    }
    .edge-right {
      right: var(--wa-space-xs);
    }
    .placeholder {
      position: absolute;
      inset: 0;
      background-size: cover;
      filter: blur(20px);
      transform: scale(1.1);
      transition: opacity 200ms;
    }
    .placeholder.loaded {
      opacity: 0;
    }
  `;

  @property({ type: Array }) photos: Photo[] = [];
  @property({ type: String }) layout: Layout = "grid";
  /** Global index of this gallery's first photo in the album-wide lightbox sequence. */
  @property({ type: Number }) startIndex = 0;
  @query(".gallery") private galleryEl!: HTMLElement;
  @state() private canLeft = false;
  @state() private canRight = false;
  private readonly onResize = () => this.updateScrollState();

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this.onResize);
  }

  override firstUpdated(): void {
    this.updateScrollState();
  }

  override updated(): void {
    this.updateScrollState();
  }

  override disconnectedCallback(): void {
    window.removeEventListener("resize", this.onResize);
    super.disconnectedCallback();
  }

  // Whether the strip can scroll further left/right (drives the chevron hints).
  private updateScrollState() {
    const el = this.galleryEl;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    this.canLeft = el.scrollLeft > 1;
    this.canRight = el.scrollLeft < max - 1;
  }

  private scrollStrip(dir: 1 | -1) {
    this.galleryEl?.scrollBy({
      left: dir * this.galleryEl.clientWidth * 0.8,
      behavior: "smooth",
    });
  }

  // The album view owns a single lightbox spanning every gallery, so clicking a
  // tile asks it to open at this photo's global index — letting the lightbox
  // flow into the next gallery instead of looping within this one.
  private openAt(i: number) {
    this.dispatchEvent(
      new CustomEvent("pswp-open", {
        detail: { index: this.startIndex + i },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`
      <div class="gallery-wrap">
        <div
          class="gallery"
          data-layout=${this.layout}
          @scroll=${() => this.updateScrollState()}
        >
          ${this.photos.map(
            (p, i) => html`
              <a
                class="tile"
                href=${fullSrc(p.filename)}
                @click=${(e: MouseEvent) => {
                  e.preventDefault();
                  this.openAt(i);
                }}
              >
                <div
                  class="placeholder"
                  style=${`background-image: url(${p.placeholder})`}
                ></div>
                <img
                  loading="lazy"
                  alt=${p.caption ?? ""}
                  src=${`/api/images/${p.filename}?w=800`}
                  srcset=${srcset(p.filename)}
                  sizes=${sizesAttr()}
                  width=${p.width}
                  height=${p.height}
                  @load=${(e: Event) => {
                    const ph = (e.target as HTMLImageElement)
                      .previousElementSibling;
                    ph?.classList.add("loaded");
                    // Image load grows scrollWidth — re-evaluate the hints.
                    this.updateScrollState();
                  }}
                />
              </a>
            `,
          )}
        </div>
        <button
          class="edge edge-left ${this.canLeft ? "show" : ""}"
          aria-label="Scroll left"
          @click=${() => this.scrollStrip(-1)}
        >
          <wa-icon name="chevron-left"></wa-icon>
        </button>
        <button
          class="edge edge-right ${this.canRight ? "show" : ""}"
          aria-label="Scroll right"
          @click=${() => this.scrollStrip(1)}
        >
          <wa-icon name="chevron-right"></wa-icon>
        </button>
      </div>
    `;
  }
}
