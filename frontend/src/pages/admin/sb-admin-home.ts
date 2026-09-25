import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, apiJSON } from "../../api";
import { navigate } from "../../router";
import { ws } from "../../store/ws";
import type { Album, Folder } from "../../types";

@customElement("sb-admin-home")
export class SbAdminHome extends LitElement {
  static override styles = css`
    .layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: var(--wa-space-l);
    }
    @media (max-width: 800px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    h2 {
      margin: 0 0 var(--wa-space-m);
      font-size: var(--wa-font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--wa-color-text-quiet);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--wa-space-xs);
      margin-bottom: var(--wa-space-m);
      align-items: end;
    }
    .row wa-input,
    .row wa-select {
      flex: 1 1 8rem;
    }
    .row wa-button {
      flex-shrink: 0;
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-2xs);
    }
    li {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      padding: 0.3rem 0.4rem;
      border-radius: var(--wa-border-radius-m);
    }
    li:hover {
      background: var(--wa-color-neutral-fill-quiet);
    }
    li[data-depth="1"] {
      padding-inline-start: 1.4rem;
    }
    li[data-depth="2"] {
      padding-inline-start: 2.4rem;
    }
    .folder-name {
      flex: 1;
      cursor: pointer;
    }
    .actions {
      display: flex;
      gap: var(--wa-space-2xs);
      opacity: 0;
    }
    li:hover .actions {
      opacity: 1;
    }
    .album-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--wa-space-m);
    }
    .album-grid wa-card {
      cursor: pointer;
    }
    .album-grid wa-card:hover {
      border-color: var(--wa-color-brand-border-loud);
    }
    .album-cover {
      aspect-ratio: 4 / 3;
      margin: calc(var(--wa-space-m) * -1) calc(var(--wa-space-m) * -1)
        var(--wa-space-xs);
      border-top-left-radius: inherit;
      border-top-right-radius: inherit;
      overflow: hidden;
      background: var(--wa-color-neutral-fill-quiet);
    }
    .album-cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .meta {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
      margin-top: var(--wa-space-2xs);
      display: flex;
      gap: var(--wa-space-xs);
      align-items: center;
    }
    .empty {
      color: var(--wa-color-text-quiet);
      padding: var(--wa-space-m) 0;
    }
    .storage-link {
      margin-top: var(--wa-space-l);
    }
  `;

  @state() private folders: Folder[] = [];
  @state() private albums: Album[] = [];
  @state() private newFolderName = "";
  @state() private newFolderParent: string | "" = "";
  @state() private newAlbumTitle = "";
  @state() private newAlbumFolder: string | "" = "";
  private unsubs: Array<() => void> = [];

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    this.unsubs.push(ws.subscribe("folder-tree", () => this.load()));
    this.unsubs.push(ws.subscribe("album-list", () => this.load()));
  }

  override disconnectedCallback(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    super.disconnectedCallback();
  }

  private async load() {
    const [folders, albums] = await Promise.all([
      api<Folder[]>("/admin/folders"),
      api<Album[]>("/admin/albums"),
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

  private async createFolder() {
    if (!this.newFolderName.trim()) return;
    await apiJSON("/admin/folders", {
      name: this.newFolderName,
      parentId: this.newFolderParent || null,
    });
    this.newFolderName = "";
    this.newFolderParent = "";
  }

  private async renameFolder(folder: Folder) {
    const name = prompt("New folder name:", folder.name);
    if (!name || name === folder.name) return;
    await api(`/admin/folders/${folder.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  }

  private async deleteFolder(folder: Folder) {
    if (!confirm(`Delete folder "${folder.name}"?`)) return;
    try {
      await api(`/admin/folders/${folder.id}`, { method: "DELETE" });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  private async createAlbum() {
    if (!this.newAlbumTitle.trim()) return;
    const album = await apiJSON<Album>("/admin/albums", {
      title: this.newAlbumTitle,
      folderId: this.newAlbumFolder || null,
    });
    this.newAlbumTitle = "";
    navigate(`/admin/albums/${album.id}`);
  }

  override render() {
    return html`
      <div class="layout">
        <wa-card>
          <h2>Folders</h2>
          <div class="row">
            <wa-input
              placeholder="New folder…"
              .value=${this.newFolderName}
              @input=${(e: Event) =>
                (this.newFolderName = (e.target as HTMLInputElement).value)}
            ></wa-input>
            <wa-select
              .value=${this.newFolderParent}
              @change=${(e: Event) =>
                (this.newFolderParent = (e.target as HTMLSelectElement).value)}
            >
              <wa-option value="">— root —</wa-option>
              ${this.folders.map(
                (f) => html`<wa-option value=${f.id}>${f.name}</wa-option>`,
              )}
            </wa-select>
            <wa-button variant="brand" @click=${this.createFolder}
              >Add</wa-button
            >
          </div>
          ${this.folders.length === 0
            ? html`<p class="empty">No folders.</p>`
            : html`<ul>
                ${this.folders.map(
                  (f) => html`
                    <li data-depth=${this.depthOf(f)}>
                      <span class="folder-name">${f.name}</span>
                      <div class="actions">
                        <wa-button
                          appearance="plain"
                          size="small"
                          @click=${() => this.renameFolder(f)}
                        >
                          <wa-icon name="pen"></wa-icon>
                        </wa-button>
                        <wa-button
                          appearance="plain"
                          size="small"
                          variant="danger"
                          @click=${() => this.deleteFolder(f)}
                        >
                          <wa-icon name="trash"></wa-icon>
                        </wa-button>
                      </div>
                    </li>
                  `,
                )}
              </ul>`}
          <div class="storage-link">
            <wa-button @click=${() => navigate("/admin/users")}>
              <wa-icon slot="start" name="users"></wa-icon>
              Manage users
            </wa-button>
            <wa-button @click=${() => navigate("/admin/storage")}>
              <wa-icon slot="start" name="database"></wa-icon>
              Open storage panel
            </wa-button>
          </div>
        </wa-card>
        <wa-card>
          <h2>Albums</h2>
          <div class="row">
            <wa-input
              placeholder="New album title…"
              .value=${this.newAlbumTitle}
              @input=${(e: Event) =>
                (this.newAlbumTitle = (e.target as HTMLInputElement).value)}
            ></wa-input>
            <wa-select
              .value=${this.newAlbumFolder}
              @change=${(e: Event) =>
                (this.newAlbumFolder = (e.target as HTMLSelectElement).value)}
            >
              <wa-option value="">— no folder —</wa-option>
              ${this.folders.map(
                (f) => html`<wa-option value=${f.id}>${f.name}</wa-option>`,
              )}
            </wa-select>
            <wa-button variant="brand" @click=${this.createAlbum}
              >Create</wa-button
            >
          </div>
          ${this.albums.length === 0
            ? html`<p class="empty">No albums yet.</p>`
            : html`<div class="album-grid">
                ${this.albums.map((a) => {
                  const folder = this.folders.find((f) => f.id === a.folder_id);
                  return html`
                    <wa-card @click=${() => navigate(`/admin/albums/${a.id}`)}>
                      ${a.cover_filename
                        ? html`<div class="album-cover">
                            <img
                              src=${`/api/images/${a.cover_filename}?w=400`}
                              alt=${a.title}
                              loading="lazy"
                            />
                          </div>`
                        : null}
                      <div>${a.title}</div>
                      <div class="meta">
                        <span>${folder?.name ?? "—"}</span>
                        <wa-tag
                          size="small"
                          variant=${a.shareable ? "brand" : "neutral"}
                        >
                          ${a.shareable ? "shareable" : "private"}
                        </wa-tag>
                      </div>
                    </wa-card>
                  `;
                })}
              </div>`}
        </wa-card>
      </div>
    `;
  }
}
