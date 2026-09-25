import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ApiError, api, apiJSON } from "../../api";
import { ws } from "../../store/ws";

type Grant = {
  user_id: string;
  granted_by: string;
  granted_at: number;
  email: string;
  name: string | null;
};

@customElement("sb-album-access")
export class SbAlbumAccess extends LitElement {
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
      padding: 0.5rem 0.6rem;
      background: var(--wa-color-surface-raised);
      border: 1px solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-m);
    }
    li .who {
      flex: 1;
    }
    .muted {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
    .empty {
      color: var(--wa-color-text-quiet);
      text-align: center;
      padding: var(--wa-space-m);
    }
  `;

  @property({ type: String }) albumId = "";
  @state() private grants: Grant[] = [];
  @state() private newEmail = "";
  @state() private error: string | null = null;
  private unsub: (() => void) | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    this.unsub = ws.subscribe(`access:album:${this.albumId}`, () =>
      this.load(),
    );
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("albumId")) {
      this.unsub?.();
      this.unsub = ws.subscribe(`access:album:${this.albumId}`, () =>
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
      this.grants = await api<Grant[]>(`/admin/albums/${this.albumId}/access`);
    } catch (e) {
      console.error(e);
    }
  }

  private async grant() {
    if (!this.newEmail) return;
    this.error = null;
    try {
      const user = await api<{ id: string }>(
        `/admin/users/by-email?email=${encodeURIComponent(this.newEmail)}`,
      );
      await apiJSON(`/admin/albums/${this.albumId}/access`, {
        userId: user.id,
      });
      this.newEmail = "";
    } catch (e) {
      this.error =
        e instanceof ApiError
          ? e.status === 404
            ? "No user with that email."
            : e.message
          : "Failed";
    }
  }

  private async revoke(g: Grant) {
    if (!confirm(`Revoke access for ${g.email}?`)) return;
    await api(`/admin/albums/${this.albumId}/access/${g.user_id}`, {
      method: "DELETE",
    });
  }

  override render() {
    return html`
      <div class="row">
        <wa-input
          label="Email"
          type="email"
          placeholder="user@example.com"
          .value=${this.newEmail}
          @input=${(e: Event) =>
            (this.newEmail = (e.target as HTMLInputElement).value)}
        ></wa-input>
        <wa-button variant="brand" @click=${this.grant}>Grant access</wa-button>
      </div>
      ${this.error
        ? html`<wa-callout variant="danger" size="small"
            >${this.error}</wa-callout
          >`
        : null}
      <wa-callout variant="neutral" size="small" appearance="outlined">
        Tip: granting access on a parent <em>folder</em> inherits to all albums
        inside.
      </wa-callout>
      ${this.grants.length === 0
        ? html`<p class="empty">No direct grants on this album.</p>`
        : html`<ul>
            ${this.grants.map(
              (g) => html`
                <li>
                  <div class="who">
                    <div>${g.name ?? g.email}</div>
                    <div class="muted">${g.email}</div>
                  </div>
                  <wa-button
                    size="small"
                    variant="danger"
                    appearance="outlined"
                    @click=${() => this.revoke(g)}
                  >
                    Revoke
                  </wa-button>
                </li>
              `,
            )}
          </ul>`}
    `;
  }
}
