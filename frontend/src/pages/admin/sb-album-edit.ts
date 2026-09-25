import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ApiError, api } from "../../api";
import { ws } from "../../store/ws";
import type {
  Album,
  AlbumBlock,
  AlbumDetail,
  Folder,
  Photo,
} from "../../types";

import "./sb-album-blocks";
import "./sb-album-shares";
import "./sb-album-access";

type Tab = "content" | "cover" | "sharing" | "access";

@customElement("sb-album-edit")
export class SbAlbumEdit extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    wa-card.meta {
      margin-bottom: var(--wa-space-m);
    }
    .meta-row {
      display: grid;
      grid-template-columns: 1fr 220px auto;
      gap: var(--wa-space-xs);
      align-items: end;
    }
    wa-textarea {
      margin-top: var(--wa-space-xs);
    }
    .shareable {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--wa-space-m);
      margin-top: var(--wa-space-m);
    }
    .empty {
      color: var(--wa-color-text-quiet);
      padding: var(--wa-space-l);
    }
    .cover-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: var(--wa-space-s);
      margin-top: var(--wa-space-s);
    }
    .cover-pick {
      position: relative;
      aspect-ratio: 1;
      border-radius: var(--wa-border-radius-m);
      overflow: hidden;
      border: 3px solid transparent;
      cursor: pointer;
    }
    .cover-pick.selected {
      border-color: var(--wa-color-brand-fill-loud);
    }
    .cover-pick img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  `;

  @property({ type: String }) albumId = "";
  @state() private detail: AlbumDetail | null = null;
  @state() private folders: Folder[] = [];
  @state() private tab: Tab = "content";
  @state() private titleDraft = "";
  @state() private descDraft = "";
  @state() private folderDraft = "";
  @state() private shareableDraft = false;
  @state() private saving = false;
  @state() private dirty = false;
  private wsUnsubs: Array<() => void> = [];

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadFolders();
    if (this.albumId) this.subscribe();
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("albumId") && this.albumId) this.subscribe();
  }

  override disconnectedCallback(): void {
    for (const u of this.wsUnsubs) u();
    this.wsUnsubs = [];
    super.disconnectedCallback();
  }

  private subscribe() {
    for (const u of this.wsUnsubs) u();
    this.wsUnsubs = [];
    this.wsUnsubs.push(
      ws.subscribe(`album:${this.albumId}`, () => {
        if (!this.dirty) void this.load();
      }),
    );
    void this.load();
  }

  private async load() {
    try {
      this.detail = await api<AlbumDetail>(`/albums/${this.albumId}`);
      this.titleDraft = this.detail.album.title;
      this.descDraft = this.detail.album.description ?? "";
      this.folderDraft = this.detail.album.folder_id ?? "";
      this.shareableDraft = this.detail.album.shareable === 1;
      this.dirty = false;
    } catch (e) {
      console.error(e);
    }
  }

  private async loadFolders() {
    this.folders = await api<Folder[]>("/admin/folders");
  }

  private markDirty() {
    this.dirty = true;
  }

  private async saveMeta() {
    if (!this.detail) return;
    this.saving = true;
    try {
      await api<Album>(`/admin/albums/${this.albumId}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: this.titleDraft,
          description: this.descDraft || null,
          folderId: this.folderDraft || null,
          shareable: this.shareableDraft,
        }),
      });
      this.dirty = false;
      await this.load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Save failed");
    } finally {
      this.saving = false;
    }
  }

  private async deleteAlbum() {
    if (
      !confirm("Delete this album and all its photos? This cannot be undone.")
    )
      return;
    await api(`/admin/albums/${this.albumId}`, { method: "DELETE" });
    history.back();
  }

  private async setCover(photoId: string | null) {
    await api(`/admin/albums/${this.albumId}/cover`, {
      method: "POST",
      body: JSON.stringify({ photoId }),
    });
    await this.load();
  }

  override render() {
    if (!this.detail) return html`<wa-spinner></wa-spinner>`;
    return html`
      <wa-card class="meta">
        <div class="meta-row">
          <wa-input
            label="Title"
            placeholder="Album title"
            .value=${this.titleDraft}
            @input=${(e: Event) => {
              this.titleDraft = (e.target as HTMLInputElement).value;
              this.markDirty();
            }}
          ></wa-input>
          <wa-select
            label="Folder"
            .value=${this.folderDraft}
            @change=${(e: Event) => {
              this.folderDraft = (e.target as HTMLSelectElement).value;
              this.markDirty();
            }}
          >
            <wa-option value="">— no folder —</wa-option>
            ${this.folders.map(
              (f) => html`<wa-option value=${f.id}>${f.name}</wa-option>`,
            )}
          </wa-select>
          <wa-button
            variant="danger"
            appearance="outlined"
            @click=${this.deleteAlbum}
          >
            Delete album
          </wa-button>
        </div>
        <wa-textarea
          label="Description"
          placeholder="Optional"
          .value=${this.descDraft}
          @input=${(e: Event) => {
            this.descDraft = (e.target as HTMLTextAreaElement).value;
            this.markDirty();
          }}
        ></wa-textarea>
        <div class="shareable">
          <wa-switch
            ?checked=${this.shareableDraft}
            @change=${(e: Event) => {
              this.shareableDraft = (e.target as HTMLInputElement).checked;
              this.markDirty();
            }}
          >
            Shareable — can create public share links
          </wa-switch>
          ${this.dirty
            ? html`<wa-button
                variant="brand"
                ?loading=${this.saving}
                @click=${this.saveMeta}
              >
                Save
              </wa-button>`
            : null}
        </div>
      </wa-card>

      <wa-tab-group
        @wa-tab-show=${(e: CustomEvent<{ name: string }>) =>
          (this.tab = e.detail.name as Tab)}
      >
        <wa-tab slot="nav" panel="content" ?active=${this.tab === "content"}>
          Content
        </wa-tab>
        <wa-tab slot="nav" panel="cover" ?active=${this.tab === "cover"}>
          Cover
        </wa-tab>
        <wa-tab slot="nav" panel="sharing" ?active=${this.tab === "sharing"}>
          Sharing
        </wa-tab>
        <wa-tab slot="nav" panel="access" ?active=${this.tab === "access"}>
          Access
        </wa-tab>

        <wa-tab-panel name="content" ?active=${this.tab === "content"}>
          <sb-album-blocks
            .albumId=${this.albumId}
            .blocks=${this.detail.blocks}
            .photos=${this.detail.photos}
          ></sb-album-blocks>
        </wa-tab-panel>
        <wa-tab-panel name="cover" ?active=${this.tab === "cover"}>
          <p class="empty">
            The cover defaults to the album's first image. Pick a specific one
            below, or choose Auto to use the first image.
          </p>
          ${this.detail.photos.length === 0
            ? html`<p class="empty">
                No images yet — add photos to a gallery block first.
              </p>`
            : html`
                <wa-button
                  size="small"
                  variant=${this.detail.album.cover_photo_id
                    ? "neutral"
                    : "brand"}
                  appearance=${this.detail.album.cover_photo_id
                    ? "outlined"
                    : "accent"}
                  @click=${() => this.setCover(null)}
                >
                  Auto (first image)
                </wa-button>
                <div class="cover-grid">
                  ${this.detail.photos.map(
                    (p) => html`
                      <div
                        class="cover-pick ${this.detail?.album
                          .cover_photo_id === p.id
                          ? "selected"
                          : ""}"
                        @click=${() => this.setCover(p.id)}
                      >
                        <img
                          src=${`/api/images/${p.filename}?w=400`}
                          alt=${p.caption ?? ""}
                        />
                      </div>
                    `,
                  )}
                </div>
              `}
        </wa-tab-panel>
        <wa-tab-panel name="sharing" ?active=${this.tab === "sharing"}>
          <sb-album-shares
            .albumId=${this.albumId}
            .shareable=${this.detail.album.shareable === 1}
          ></sb-album-shares>
        </wa-tab-panel>
        <wa-tab-panel name="access" ?active=${this.tab === "access"}>
          <sb-album-access .albumId=${this.albumId}></sb-album-access>
        </wa-tab-panel>
      </wa-tab-group>
    `;
  }
}

// Re-export so child components can import the same shape.
export type { AlbumBlock, Photo };
