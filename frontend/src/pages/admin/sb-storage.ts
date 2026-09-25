import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, apiJSON } from "../../api";
import { ws } from "../../store/ws";

type StorageStats = {
  db: { size_bytes: number; path: string };
  originals: { file_count: number; size_bytes: number };
  variants: { file_count: number; size_bytes: number };
  orphans: { missing_on_disk: number; unknown_on_disk: number };
};

@customElement("sb-storage")
export class SbStorage extends LitElement {
  static override styles = css`
    :host {
      display: block;
      max-width: 720px;
    }
    h1 {
      margin: 0 0 var(--wa-space-m);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--wa-space-m);
    }
    .label {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .value {
      font-size: var(--wa-font-size-xl);
      font-weight: var(--wa-font-weight-semibold);
      margin-top: var(--wa-space-2xs);
    }
    .value.warn {
      color: var(--wa-color-warning-on-quiet);
    }
    .sub {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
      margin-top: var(--wa-space-2xs);
    }
  `;

  @state() private stats: StorageStats | null = null;
  private unsub: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    this.unsub = ws.subscribe("storage-stats", () => this.load());
  }

  override disconnectedCallback(): void {
    this.unsub?.();
    super.disconnectedCallback();
  }

  private async load() {
    this.stats = await api<StorageStats>("/admin/storage");
  }

  private async clearCache() {
    if (
      !confirm(
        "Delete all generated image variants? They'll regenerate on next request.",
      )
    )
      return;
    await apiJSON("/admin/storage/clear-cache", {});
  }

  override render() {
    const s = this.stats;
    if (!s) return html`<wa-spinner></wa-spinner>`;
    return html`
      <h1>Storage</h1>
      <div class="grid">
        <wa-card>
          <div class="label">Database</div>
          <div class="value">${formatBytes(s.db.size_bytes)}</div>
          <div class="sub">${s.db.path}</div>
        </wa-card>
        <wa-card>
          <div class="label">Originals</div>
          <div class="value">${formatBytes(s.originals.size_bytes)}</div>
          <div class="sub">${s.originals.file_count} files</div>
        </wa-card>
        <wa-card>
          <div class="label">Variants cache</div>
          <div class="value">${formatBytes(s.variants.size_bytes)}</div>
          <div class="sub">${s.variants.file_count} files</div>
          <wa-button slot="footer" @click=${this.clearCache}
            >Clear cache</wa-button
          >
        </wa-card>
        <wa-card>
          <div class="label">Orphans</div>
          <div
            class="value ${s.orphans.missing_on_disk +
              s.orphans.unknown_on_disk >
            0
              ? "warn"
              : ""}"
          >
            ${s.orphans.missing_on_disk + s.orphans.unknown_on_disk}
          </div>
          <div class="sub">
            ${s.orphans.missing_on_disk} missing on disk ·
            ${s.orphans.unknown_on_disk} unknown on disk
          </div>
        </wa-card>
      </div>
    `;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
