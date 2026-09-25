import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ApiError, api, apiJSON } from "../../api";
import { ws } from "../../store/ws";

type ShareLink = {
  id: string;
  token: string;
  expires_at: number | null;
  revoked_at: number | null;
  has_password: boolean;
  created_at: number;
};

@customElement("sb-album-shares")
export class SbAlbumShares extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    .row {
      display: flex;
      gap: var(--wa-space-xs);
      align-items: end;
      margin-bottom: var(--wa-space-m);
    }
    .row wa-input {
      flex: 1;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--wa-color-surface-raised);
      border-radius: var(--wa-border-radius-m);
      overflow: hidden;
      border: 1px solid var(--wa-color-surface-border);
    }
    th,
    td {
      padding: 0.6rem 0.8rem;
      border-bottom: 1px solid var(--wa-color-surface-border);
      text-align: left;
      font-size: var(--wa-font-size-s);
    }
    tr:last-child td {
      border-bottom: none;
    }
    th {
      color: var(--wa-color-text-quiet);
      font-weight: var(--wa-font-weight-normal);
      background: var(--wa-color-neutral-fill-quiet);
    }
    .url {
      font-family: var(--wa-font-family-code);
      font-size: var(--wa-font-size-xs);
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty {
      color: var(--wa-color-text-quiet);
      text-align: center;
      padding: var(--wa-space-m);
    }
    .copied {
      color: var(--wa-color-success-on-quiet);
      font-size: var(--wa-font-size-s);
      margin-inline-start: var(--wa-space-xs);
    }
    .actions {
      display: flex;
      gap: var(--wa-space-2xs);
      align-items: center;
    }
  `;

  @property({ type: String }) albumId = "";
  @property({ type: Boolean }) shareable = false;
  @state() private links: ShareLink[] = [];
  @state() private newPassword = "";
  @state() private newExpiryDays = "";
  @state() private copiedToken: string | null = null;
  private unsub: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    this.unsub = ws.subscribe(`share-links:album:${this.albumId}`, () =>
      this.load(),
    );
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("albumId")) {
      this.unsub?.();
      this.unsub = ws.subscribe(`share-links:album:${this.albumId}`, () =>
        this.load(),
      );
      void this.load();
    }
  }

  override disconnectedCallback(): void {
    this.unsub?.();
    super.disconnectedCallback();
  }

  private async load() {
    try {
      this.links = await api<ShareLink[]>(
        `/admin/albums/${this.albumId}/share`,
      );
    } catch (e) {
      console.error(e);
    }
  }

  private async createLink() {
    if (!this.shareable) return;
    const body: Record<string, unknown> = {};
    if (this.newPassword) body.password = this.newPassword;
    if (this.newExpiryDays) {
      body.expiresAt = Date.now() + Number(this.newExpiryDays) * 86_400_000;
    }
    try {
      await apiJSON(`/admin/albums/${this.albumId}/share`, body);
      this.newPassword = "";
      this.newExpiryDays = "";
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "Failed");
    }
  }

  private async revoke(token: string) {
    if (!confirm("Revoke this share link?")) return;
    await api(`/admin/albums/${this.albumId}/share/${token}`, {
      method: "DELETE",
    });
  }

  private async copy(token: string) {
    const url = `${location.origin}/share/${token}`;
    await navigator.clipboard.writeText(url);
    this.copiedToken = token;
    setTimeout(() => {
      if (this.copiedToken === token) this.copiedToken = null;
    }, 1500);
  }

  override render() {
    const active = this.links.filter((l) => !l.revoked_at);
    return html`
      ${!this.shareable
        ? html`<wa-callout variant="warning">
            Album is not marked shareable — enable "shareable" on the album to
            create share links.
          </wa-callout>`
        : html`<div class="row">
            <wa-input
              label="Password (optional)"
              type="password"
              .value=${this.newPassword}
              @input=${(e: Event) =>
                (this.newPassword = (e.target as HTMLInputElement).value)}
            ></wa-input>
            <wa-input
              label="Expires in days (optional)"
              type="number"
              min="1"
              .value=${this.newExpiryDays}
              @input=${(e: Event) =>
                (this.newExpiryDays = (e.target as HTMLInputElement).value)}
            ></wa-input>
            <wa-button variant="brand" @click=${this.createLink}>
              Create share link
            </wa-button>
          </div>`}
      ${active.length === 0
        ? html`<p class="empty">No active share links.</p>`
        : html`<table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Password</th>
                <th>Expires</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${active.map(
                (l) => html`
                  <tr>
                    <td class="url">/share/${l.token}</td>
                    <td>
                      ${l.has_password
                        ? html`<wa-tag size="small">yes</wa-tag>`
                        : "—"}
                    </td>
                    <td>
                      ${l.expires_at
                        ? new Date(l.expires_at).toLocaleDateString()
                        : "never"}
                    </td>
                    <td>${new Date(l.created_at).toLocaleDateString()}</td>
                    <td>
                      <div class="actions">
                        <wa-button
                          size="small"
                          @click=${() => this.copy(l.token)}
                        >
                          <wa-icon slot="start" name="copy"></wa-icon>
                          Copy
                        </wa-button>
                        <wa-button
                          size="small"
                          variant="danger"
                          appearance="outlined"
                          @click=${() => this.revoke(l.token)}
                        >
                          Revoke
                        </wa-button>
                        ${this.copiedToken === l.token
                          ? html`<span class="copied">Copied!</span>`
                          : null}
                      </div>
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>`}
    `;
  }
}
