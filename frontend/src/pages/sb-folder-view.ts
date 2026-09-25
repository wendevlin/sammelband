import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ApiError, api } from "../api";
import { navigate } from "../router";
import { ws } from "../store/ws";
import type { Album, Folder } from "../types";

@customElement("sb-folder-view")
export class SbFolderView extends LitElement {
  static override styles = css`
    h1 {
      margin: 0 0 var(--wa-space-m);
    }
    h2 {
      margin-top: var(--wa-space-l);
      font-size: var(--wa-font-size-m);
      color: var(--wa-color-text-quiet);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--wa-space-m);
    }
    wa-card {
      cursor: pointer;
    }
    .name {
      font-weight: var(--wa-font-weight-semibold);
    }
    .empty {
      color: var(--wa-color-text-quiet);
    }
  `;

  @property({ type: String }) folderId = "";
  @state() private folders: Folder[] = [];
  @state() private albums: Album[] = [];
  @state() private error: string | null = null;
  private wsUnsub: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("folderId") && this.folderId) {
      this.wsUnsub?.();
      this.wsUnsub = ws.subscribe(`folder:${this.folderId}`, () => this.load());
      void this.load();
    }
  }

  override disconnectedCallback(): void {
    this.wsUnsub?.();
    this.wsUnsub = null;
    super.disconnectedCallback();
  }

  private async load() {
    try {
      const res = await api<{ folders: Folder[]; albums: Album[] }>(
        `/folders/${this.folderId}`,
      );
      this.folders = res.folders;
      this.albums = res.albums;
      this.error = null;
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : "Failed to load";
    }
  }

  override render() {
    if (this.error) {
      return html`<wa-callout variant="danger">${this.error}</wa-callout>`;
    }
    return html`
      <h1>Folder</h1>
      ${this.folders.length === 0 && this.albums.length === 0
        ? html`<p class="empty">This folder is empty.</p>`
        : null}
      ${this.folders.length > 0
        ? html`
            <h2>Sub-folders</h2>
            <div class="grid">
              ${this.folders.map(
                (f) => html`
                  <wa-card @click=${() => navigate(`/folders/${f.id}`)}>
                    <div class="name">${f.name}</div>
                  </wa-card>
                `,
              )}
            </div>
          `
        : null}
      ${this.albums.length > 0
        ? html`
            <h2>Albums</h2>
            <div class="grid">
              ${this.albums.map(
                (a) => html`
                  <wa-card @click=${() => navigate(`/albums/${a.id}`)}>
                    <div class="name">${a.title}</div>
                  </wa-card>
                `,
              )}
            </div>
          `
        : null}
    `;
  }
}
