import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, apiJSON } from "../../api";
import type { AlbumBlock, Photo } from "../../types";
import "./sb-gallery-photos";

type BlockType = "heading" | "text" | "gallery" | "group";
type DraftContent = Record<string, unknown>;

const GROUP_BACKGROUNDS = [
  ["none", "None (border only)"],
  ["auto", "Auto (from gallery)"],
  ["neutral", "Neutral"],
  ["blue", "Blue"],
  ["green", "Green"],
  ["amber", "Amber"],
  ["rose", "Rose"],
] as const;

@customElement("sb-album-blocks")
export class SbAlbumBlocks extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    .toolbar {
      display: flex;
      gap: var(--wa-space-xs);
      margin-bottom: var(--wa-space-m);
    }
    .blocks {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    wa-card.block {
      position: relative;
    }
    wa-card.block.dragging {
      opacity: 0.4;
    }
    wa-card.block.drop-target-before::before,
    wa-card.block.drop-target-after::after {
      content: "";
      display: block;
      height: 3px;
      background: var(--wa-color-brand-fill-loud);
      margin: var(--wa-space-xs) 0;
      border-radius: 2px;
    }
    .block-header {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      margin-bottom: var(--wa-space-xs);
    }
    .handle {
      cursor: grab;
      color: var(--wa-color-text-quiet);
      user-select: none;
      padding: 0 var(--wa-space-2xs);
    }
    .kind {
      font-size: var(--wa-font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--wa-color-text-quiet);
      flex: 1;
    }
    .row {
      display: flex;
      gap: var(--wa-space-xs);
      margin-bottom: var(--wa-space-xs);
      align-items: end;
    }
    .row wa-input {
      flex: 1;
    }
    .gallery-picker {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: var(--wa-space-xs);
      margin-top: var(--wa-space-xs);
    }
    .pick {
      position: relative;
      border-radius: var(--wa-border-radius-m);
      overflow: hidden;
      aspect-ratio: 1;
      cursor: pointer;
      border: 3px solid transparent;
    }
    .pick.selected {
      border-color: var(--wa-color-brand-fill-loud);
    }
    .pick img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .order-badge {
      position: absolute;
      top: 4px;
      right: 4px;
      background: var(--wa-color-brand-fill-loud);
      color: var(--wa-color-brand-on-loud);
      width: 22px;
      height: 22px;
      display: grid;
      place-items: center;
      font-size: var(--wa-font-size-xs);
      font-weight: var(--wa-font-weight-semibold);
      border-radius: 50%;
    }
    .empty {
      color: var(--wa-color-text-quiet);
      padding: var(--wa-space-l);
      text-align: center;
    }
    .group-children {
      margin-top: var(--wa-space-m);
      padding-left: var(--wa-space-m);
      border-left: 3px solid var(--wa-color-surface-border);
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    .group-add {
      display: flex;
      gap: var(--wa-space-2xs);
      flex-wrap: wrap;
    }
  `;

  @property({ type: String }) albumId = "";
  @property({ type: Array }) blocks: AlbumBlock[] = [];
  @property({ type: Array }) photos: Photo[] = [];

  /** Per-block draft content while editing. */
  @state() private drafts = new Map<string, DraftContent>();
  @state() private dragId: string | null = null;
  @state() private dropTarget: {
    id: string;
    position: "before" | "after";
  } | null = null;

  private contentOf(block: AlbumBlock): DraftContent {
    const cached = this.drafts.get(block.id);
    if (cached) return cached;
    try {
      return JSON.parse(block.content);
    } catch {
      return {};
    }
  }

  private setDraft(blockId: string, patch: Partial<DraftContent>) {
    const next = new Map(this.drafts);
    next.set(blockId, {
      ...this.contentOf(this.blocks.find((b) => b.id === blockId)!),
      ...patch,
    });
    this.drafts = next;
  }

  private isDirty(blockId: string): boolean {
    const draft = this.drafts.get(blockId);
    if (!draft) return false;
    const block = this.blocks.find((b) => b.id === blockId);
    if (!block) return false;
    try {
      const stored = JSON.parse(block.content);
      return JSON.stringify(stored) !== JSON.stringify(draft);
    } catch {
      return true;
    }
  }

  private async addBlock(type: BlockType, parentId: string | null = null) {
    const siblings = this.blocks.filter(
      (b) => (b.parent_id ?? null) === parentId,
    );
    const lastId = siblings[siblings.length - 1]?.id;
    const content =
      type === "heading"
        ? { level: 2, text: "Heading" }
        : type === "text"
          ? { markdown: "" }
          : type === "group"
            ? { background: "none" }
            : { layout: "grid" };
    await apiJSON(`/admin/albums/${this.albumId}/blocks`, {
      type,
      content,
      parentId,
      afterId: lastId,
    });
  }

  private async assignGroup(block: AlbumBlock, parentId: string | null) {
    if ((block.parent_id ?? null) === parentId) return;
    await api(`/admin/albums/${this.albumId}/blocks/${block.id}`, {
      method: "PATCH",
      body: JSON.stringify({ parentId }),
    });
  }

  private async saveBlock(block: AlbumBlock) {
    const draft = this.drafts.get(block.id);
    if (!draft) return;
    await api(`/admin/albums/${this.albumId}/blocks/${block.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: draft }),
    });
    const next = new Map(this.drafts);
    next.delete(block.id);
    this.drafts = next;
  }

  private async deleteBlock(block: AlbumBlock) {
    if (!confirm("Delete this block?")) return;
    await api(`/admin/albums/${this.albumId}/blocks/${block.id}`, {
      method: "DELETE",
    });
  }

  private onDragStart(e: DragEvent, block: AlbumBlock) {
    this.dragId = block.id;
    e.dataTransfer?.setData("text/plain", block.id);
    e.dataTransfer!.effectAllowed = "move";
  }

  private onDragOver(e: DragEvent, block: AlbumBlock) {
    if (!this.dragId || this.dragId === block.id) return;
    // Reordering is scoped to siblings of the same parent.
    const dragged = this.blocks.find((b) => b.id === this.dragId);
    if (!dragged || (dragged.parent_id ?? null) !== (block.parent_id ?? null))
      return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position =
      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    this.dropTarget = { id: block.id, position };
  }

  private onDragEnd() {
    this.dragId = null;
    this.dropTarget = null;
  }

  private async onDrop(e: DragEvent, targetBlock: AlbumBlock) {
    e.preventDefault();
    const draggedId = this.dragId;
    if (!draggedId || draggedId === targetBlock.id) {
      this.onDragEnd();
      return;
    }
    // Reorder only within the target's sibling set (same parent). sort_order is
    // scoped per parent, so 1..n among siblings is the correct sequence.
    const parentId = targetBlock.parent_id ?? null;
    const siblings = this.blocks.filter(
      (b) => (b.parent_id ?? null) === parentId,
    );
    const fromIdx = siblings.findIndex((b) => b.id === draggedId);
    if (fromIdx === -1) {
      this.onDragEnd();
      return;
    }
    const [dragged] = siblings.splice(fromIdx, 1);
    let toIdx = siblings.findIndex((b) => b.id === targetBlock.id);
    if (this.dropTarget?.position === "after") toIdx += 1;
    siblings.splice(toIdx, 0, dragged!);

    const reordered = siblings.map((b, i) => ({ id: b.id, sortOrder: i + 1 }));
    await apiJSON(`/admin/albums/${this.albumId}/blocks/reorder`, {
      order: reordered,
    });
    this.onDragEnd();
  }

  /** Group blocks, in display order — for the per-block "Group" assignment select. */
  private get groups(): AlbumBlock[] {
    return this.blocks.filter((b) => b.type === "group");
  }

  private groupLabel(groupId: string): string {
    const idx = this.groups.findIndex((g) => g.id === groupId);
    return `Group ${idx + 1}`;
  }

  override render() {
    const topLevel = this.blocks.filter((b) => !b.parent_id);
    return html`
      <div class="toolbar">
        <wa-button @click=${() => this.addBlock("heading")}>
          <wa-icon slot="start" name="plus"></wa-icon>
          Heading
        </wa-button>
        <wa-button @click=${() => this.addBlock("text")}>
          <wa-icon slot="start" name="plus"></wa-icon>
          Text
        </wa-button>
        <wa-button @click=${() => this.addBlock("gallery")}>
          <wa-icon slot="start" name="plus"></wa-icon>
          Gallery
        </wa-button>
        <wa-button @click=${() => this.addBlock("group")}>
          <wa-icon slot="start" name="plus"></wa-icon>
          Group
        </wa-button>
      </div>
      ${topLevel.length === 0
        ? html`<p class="empty">No blocks yet — add one above.</p>`
        : html`<div class="blocks">
            ${topLevel.map((b) => this.renderBlockCard(b))}
          </div>`}
    `;
  }

  private renderBlockCard(b: AlbumBlock): TemplateResult {
    return html`
      <wa-card
        class="block ${this.dragId === b.id ? "dragging" : ""}
          ${this.dropTarget?.id === b.id &&
        this.dropTarget.position === "before"
          ? "drop-target-before"
          : ""}
          ${this.dropTarget?.id === b.id && this.dropTarget.position === "after"
          ? "drop-target-after"
          : ""}"
        @dragover=${(e: DragEvent) => this.onDragOver(e, b)}
        @drop=${(e: DragEvent) => this.onDrop(e, b)}
      >
        <div class="block-header">
          <span
            class="handle"
            draggable="true"
            @dragstart=${(e: DragEvent) => this.onDragStart(e, b)}
            @dragend=${this.onDragEnd}
            >⋮⋮</span
          >
          <span class="kind">${b.type}</span>
          ${b.type !== "group" ? this.renderGroupSelect(b) : nothing}
          ${this.isDirty(b.id)
            ? html`<wa-button
                variant="brand"
                size="small"
                @click=${() => this.saveBlock(b)}
              >
                Save
              </wa-button>`
            : nothing}
          <wa-button
            variant="danger"
            appearance="plain"
            size="small"
            @click=${() => this.deleteBlock(b)}
          >
            <wa-icon name="trash"></wa-icon>
          </wa-button>
        </div>
        ${this.renderEditor(b)}
        ${b.type === "group" ? this.renderGroupChildren(b) : nothing}
      </wa-card>
    `;
  }

  /** Per-block control to move a block into a group or back to top level. */
  private renderGroupSelect(block: AlbumBlock) {
    const others = this.groups.filter((g) => g.id !== block.id);
    if (others.length === 0) return nothing;
    return html`<wa-select
      size="small"
      .value=${block.parent_id ?? ""}
      @change=${(e: Event) =>
        this.assignGroup(block, (e.target as HTMLSelectElement).value || null)}
    >
      <wa-option value="">Top level</wa-option>
      ${others.map(
        (g) =>
          html`<wa-option value=${g.id}>${this.groupLabel(g.id)}</wa-option>`,
      )}
    </wa-select>`;
  }

  private renderGroupChildren(group: AlbumBlock): TemplateResult {
    const children = this.blocks.filter((b) => b.parent_id === group.id);
    return html`
      <div class="group-children">
        <div class="group-add">
          <wa-button
            size="small"
            appearance="outlined"
            @click=${() => this.addBlock("heading", group.id)}
            >+ Heading</wa-button
          >
          <wa-button
            size="small"
            appearance="outlined"
            @click=${() => this.addBlock("text", group.id)}
            >+ Text</wa-button
          >
          <wa-button
            size="small"
            appearance="outlined"
            @click=${() => this.addBlock("gallery", group.id)}
            >+ Gallery</wa-button
          >
        </div>
        ${children.length === 0
          ? html`<p class="empty">
              Empty group — add blocks above, or assign existing blocks via
              their Group dropdown.
            </p>`
          : children.map((c) => this.renderBlockCard(c))}
      </div>
    `;
  }

  private renderEditor(block: AlbumBlock) {
    const draft = this.contentOf(block);
    if (block.type === "group") {
      const background = String(
        (draft as { background?: string }).background ?? "none",
      );
      return html`
        <div class="row">
          <wa-select
            label="Background"
            .value=${background}
            @change=${(e: Event) =>
              this.setDraft(block.id, {
                background: (e.target as HTMLSelectElement).value,
              })}
          >
            ${GROUP_BACKGROUNDS.map(
              ([value, label]) =>
                html`<wa-option value=${value}>${label}</wa-option>`,
            )}
          </wa-select>
        </div>
      `;
    }
    if (block.type === "heading") {
      return html`
        <div class="row">
          <wa-select
            .value=${String((draft as { level?: number }).level ?? 2)}
            @change=${(e: Event) =>
              this.setDraft(block.id, {
                level: Number((e.target as HTMLSelectElement).value),
              })}
          >
            <wa-option value="1">H1</wa-option>
            <wa-option value="2">H2</wa-option>
            <wa-option value="3">H3</wa-option>
          </wa-select>
          <wa-input
            .value=${String((draft as { text?: string }).text ?? "")}
            @input=${(e: Event) =>
              this.setDraft(block.id, {
                text: (e.target as HTMLInputElement).value,
              })}
          ></wa-input>
        </div>
      `;
    }
    if (block.type === "text") {
      return html`<wa-textarea
        placeholder="Markdown content…"
        rows="6"
        resize="vertical"
        .value=${String((draft as { markdown?: string }).markdown ?? "")}
        @input=${(e: Event) =>
          this.setDraft(block.id, {
            markdown: (e.target as HTMLTextAreaElement).value,
          })}
      ></wa-textarea>`;
    }
    if (block.type === "gallery") {
      const layout = (draft as { layout?: string }).layout ?? "grid";
      const blockPhotos = this.photos
        .filter((p) => p.block_id === block.id)
        .sort((a, b) => a.sort_order - b.sort_order);
      return html`
        <div class="row">
          <wa-select
            label="Layout"
            .value=${layout}
            @change=${(e: Event) =>
              this.setDraft(block.id, {
                layout: (e.target as HTMLSelectElement).value,
              })}
          >
            <wa-option value="grid">Grid</wa-option>
            <wa-option value="masonry">Masonry</wa-option>
            <wa-option value="strip">Strip</wa-option>
          </wa-select>
        </div>
        <sb-gallery-photos
          .blockId=${block.id}
          .photos=${blockPhotos}
        ></sb-gallery-photos>
      `;
    }
    return null;
  }
}
