import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, apiJSON } from "../../api";
import type { Photo } from "../../types";

type UploadResult = {
  uploaded: Array<{ photo: Photo; deduplicated: boolean }>;
};

/**
 * Photo manager for a single gallery block: upload (drag/drop), caption, delete,
 * and drag-reorder. Photos belong to the block (block_id); deleting one removes
 * it from disk + cache server-side.
 */
@customElement("sb-gallery-photos")
export class SbGalleryPhotos extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    .drop {
      border: 2px dashed var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
      padding: var(--wa-space-m);
      text-align: center;
      color: var(--wa-color-text-quiet);
      margin: var(--wa-space-xs) 0;
      transition:
        background 120ms,
        border-color 120ms;
    }
    .drop.over {
      border-color: var(--wa-color-brand-border-loud);
      background: var(--wa-color-brand-fill-quiet);
    }
    .drop input {
      display: none;
    }
    .drop label {
      color: var(--wa-color-text-link);
      text-decoration: underline;
      cursor: pointer;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: var(--wa-space-s);
    }
    .cell {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-2xs);
    }
    .cell.dragging {
      opacity: 0.4;
    }
    .cell.drop-before {
      box-shadow: -3px 0 0 0 var(--wa-color-brand-fill-loud);
    }
    .cell.drop-after {
      box-shadow: 3px 0 0 0 var(--wa-color-brand-fill-loud);
    }
    .tile {
      position: relative;
      aspect-ratio: 1;
      border-radius: var(--wa-border-radius-m);
      overflow: hidden;
      background: var(--wa-color-surface-lowered);
      cursor: grab;
    }
    .tile img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }
    .tile .actions {
      position: absolute;
      top: 4px;
      right: 4px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 120ms;
    }
    .tile:hover .actions {
      opacity: 1;
    }
    .empty {
      color: var(--wa-color-text-quiet);
      text-align: center;
      padding: var(--wa-space-s);
    }
    .status {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
      margin-bottom: var(--wa-space-xs);
    }
  `;

  @property({ type: String }) blockId = "";
  @property({ type: Array }) photos: Photo[] = [];
  @state() private over = false;
  @state() private status: string | null = null;
  @state() private dragId: string | null = null;
  @state() private dropTarget: {
    id: string;
    position: "before" | "after";
  } | null = null;

  private async uploadFiles(files: FileList | File[]) {
    if (!files.length) return;
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    this.status = `Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`;
    try {
      const res = await api<UploadResult>(
        `/admin/blocks/${this.blockId}/photos`,
        {
          method: "POST",
          body: fd,
        },
      );
      const dups = res.uploaded.filter((u) => u.deduplicated).length;
      this.status = dups
        ? `Uploaded ${res.uploaded.length}; ${dups} dedup (already on disk).`
        : `Uploaded ${res.uploaded.length}.`;
    } catch (e) {
      this.status = e instanceof Error ? e.message : "Upload failed";
    }
  }

  private onPick(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) void this.uploadFiles(input.files);
    input.value = "";
  }

  private onDragOver(e: DragEvent) {
    e.preventDefault();
    this.over = true;
  }

  private async deletePhoto(p: Photo) {
    if (!confirm("Delete this photo? It will be removed from disk.")) return;
    await api(`/admin/photos/${p.id}`, { method: "DELETE" });
  }

  private async saveCaption(p: Photo, raw: string) {
    const caption = raw.trim() === "" ? null : raw;
    if (caption === (p.caption ?? null)) return;
    await api(`/admin/photos/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ caption }),
    });
  }

  private onTileDragOver(e: DragEvent, p: Photo) {
    if (!this.dragId || this.dragId === p.id) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position =
      e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    this.dropTarget = { id: p.id, position };
  }

  private async onTileDrop(target: Photo) {
    const draggedId = this.dragId;
    if (!draggedId || draggedId === target.id) return this.resetDrag();
    const arr = [...this.photos];
    const from = arr.findIndex((p) => p.id === draggedId);
    if (from === -1) return this.resetDrag();
    const [dragged] = arr.splice(from, 1);
    let to = arr.findIndex((p) => p.id === target.id);
    if (this.dropTarget?.position === "after") to += 1;
    arr.splice(to, 0, dragged!);
    const order = arr.map((p, i) => ({ id: p.id, sortOrder: i + 1 }));
    this.resetDrag();
    await apiJSON(`/admin/blocks/${this.blockId}/photos/reorder`, { order });
  }

  private resetDrag() {
    this.dragId = null;
    this.dropTarget = null;
  }

  override render() {
    return html`
      ${this.status ? html`<div class="status">${this.status}</div>` : null}
      ${this.photos.length === 0
        ? html`<p class="empty">No photos in this gallery yet.</p>`
        : html`<div class="grid">
            ${this.photos.map(
              (p) => html`
                <div
                  class="cell ${this.dragId === p.id ? "dragging" : ""}
                    ${this.dropTarget?.id === p.id &&
                  this.dropTarget.position === "before"
                    ? "drop-before"
                    : ""}
                    ${this.dropTarget?.id === p.id &&
                  this.dropTarget.position === "after"
                    ? "drop-after"
                    : ""}"
                  @dragover=${(e: DragEvent) => this.onTileDragOver(e, p)}
                  @drop=${() => this.onTileDrop(p)}
                >
                  <div
                    class="tile"
                    draggable="true"
                    @dragstart=${() => (this.dragId = p.id)}
                    @dragend=${() => this.resetDrag()}
                  >
                    <img
                      src=${`/api/images/${p.filename}?w=400`}
                      alt=${p.caption ?? ""}
                    />
                    <div class="actions">
                      <wa-button
                        size="small"
                        variant="danger"
                        appearance="filled"
                        circle
                        @click=${() => this.deletePhoto(p)}
                      >
                        <wa-icon name="xmark"></wa-icon>
                      </wa-button>
                    </div>
                  </div>
                  <wa-input
                    size="small"
                    placeholder="Caption…"
                    .value=${p.caption ?? ""}
                    @change=${(e: Event) =>
                      this.saveCaption(p, (e.target as HTMLInputElement).value)}
                  ></wa-input>
                </div>
              `,
            )}
          </div>`}
      <div
        class="drop ${this.over ? "over" : ""}"
        @dragover=${this.onDragOver}
        @dragleave=${() => (this.over = false)}
        @drop=${(e: DragEvent) => {
          e.preventDefault();
          this.over = false;
          const files = e.dataTransfer?.files;
          if (files?.length) void this.uploadFiles(files);
        }}
      >
        Drop photos here, or
        <label
          >browse<input
            type="file"
            multiple
            accept="image/*"
            @change=${this.onPick}
        /></label>
      </div>
    `;
  }
}
