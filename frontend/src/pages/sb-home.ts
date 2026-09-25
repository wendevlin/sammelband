import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api";
import { navigate } from "../router";
import { ws } from "../store/ws";
import type { Album, Folder } from "../types";

@customElement("sb-home")
export class SbHome extends LitElement {
  static override styles = css`
    .grid {
      display: grid;
      grid-template-columns: 240px 1fr;
      gap: var(--wa-space-l);
    }
    @media (max-width: 720px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    h2 {
      margin: 0 0 var(--wa-space-m);
      font-size: var(--wa-font-size-xs);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--wa-color-text-quiet);
    }
    aside ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-2xs);
    }
    aside li[data-depth="1"] {
      padding-inline-start: var(--wa-space-m);
    }
    aside li[data-depth="2"] {
      padding-inline-start: var(--wa-space-l);
    }
    aside a {
      display: block;
      padding: 0.4rem 0.6rem;
      border-radius: var(--wa-border-radius-m);
      color: var(--wa-color-text-normal);
    }
    aside a:hover {
      background: var(--wa-color-neutral-fill-quiet);
      text-decoration: none;
    }
    .albums {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--wa-space-m);
    }
    wa-card {
      cursor: pointer;
      transition: transform 120ms ease;
    }
    wa-card:hover {
      transform: translateY(-2px);
    }
    .cover {
      aspect-ratio: 4 / 3;
      background: linear-gradient(
        135deg,
        var(--wa-color-neutral-fill-normal),
        var(--wa-color-neutral-fill-loud)
      );
      margin: calc(var(--wa-space-m) * -1) calc(var(--wa-space-m) * -1)
        var(--wa-space-m);
      border-top-left-radius: inherit;
      border-top-right-radius: inherit;
      overflow: hidden;
    }
    .cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .title {
      font-weight: var(--wa-font-weight-semibold);
    }
    .desc {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
      margin-top: var(--wa-space-2xs);
    }
    .empty {
      color: var(--wa-color-text-quiet);
      padding: var(--wa-space-l) 0;
    }
  `;

  @state() private folders: Folder[] = [];
  @state() private albums: Album[] = [];

  private wsUnsubs: Array<() => void> = [];

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    this.wsUnsubs.push(ws.subscribe("folder-tree", () => this.load()));
    this.wsUnsubs.push(ws.subscribe("album-list", () => this.load()));
  }

  override disconnectedCallback(): void {
    for (const u of this.wsUnsubs) u();
    this.wsUnsubs = [];
    super.disconnectedCallback();
  }

  private async load() {
    const [folders, albums] = await Promise.all([
      api<Folder[]>("/folders"),
      api<Album[]>("/albums"),
    ]);
    this.folders = folders;
    this.albums = albums;
  }

  private depthOf(folder: Folder): number {
    let depth = 0;
    let current: Folder | undefined = folder;
    while (current?.parent_id) {
      const parent = this.folders.find((f) => f.id === current!.parent_id);
      if (!parent) break;
      depth++;
      current = parent;
    }
    return Math.min(depth, 2);
  }

  override render() {
    return html`
      <div class="grid">
        <aside>
          <h2>Folders</h2>
          ${this.folders.length === 0
            ? html`<p class="empty">No accessible folders.</p>`
            : html`<ul>
                ${this.folders.map(
                  (f) => html`
                    <li data-depth=${this.depthOf(f)}>
                      <a
                        href="/folders/${f.id}"
                        @click=${(e: MouseEvent) => {
                          e.preventDefault();
                          navigate(`/folders/${f.id}`);
                        }}
                      >
                        ${f.name}
                      </a>
                    </li>
                  `,
                )}
              </ul>`}
        </aside>
        <section>
          <h2>Albums</h2>
          ${this.albums.length === 0
            ? html`<p class="empty">No accessible albums yet.</p>`
            : html`<div class="albums">
                ${this.albums.map(
                  (a) => html`
                    <wa-card @click=${() => navigate(`/albums/${a.id}`)}>
                      <div class="cover">
                        ${a.cover_filename
                          ? html`<img
                              src=${`/api/images/${a.cover_filename}?w=400`}
                              alt=${a.title}
                              loading="lazy"
                            />`
                          : null}
                      </div>
                      <div class="title">${a.title}</div>
                      ${a.description
                        ? html`<div class="desc">${a.description}</div>`
                        : null}
                    </wa-card>
                  `,
                )}
              </div>`}
        </section>
      </div>
    `;
  }
}
