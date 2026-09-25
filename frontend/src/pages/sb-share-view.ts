import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ApiError, api } from "../api";
import type { Album, AlbumDetail, Folder } from "../types";
import "./sb-album-view";

type SharePayload =
  | ({ type: "album" } & AlbumDetail)
  | { type: "folder"; folder: Folder; albums: Album[] };

@customElement("sb-share-view")
export class SbShareView extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: var(--wa-space-l);
      max-width: 1200px;
      margin: 0 auto;
    }
    .password-card {
      max-width: 360px;
      margin: 4rem auto;
    }
    .password-card h1 {
      margin: 0 0 var(--wa-space-m);
      font-size: var(--wa-font-size-l);
    }
    .password-card form {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    .folder-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: var(--wa-space-m);
    }
    wa-card {
      cursor: pointer;
    }
  `;

  @property({ type: String }) token = "";

  @state() private payload: SharePayload | null = null;
  @state() private password = "";
  @state() private needsPassword = false;
  @state() private wrongPassword = false;
  @state() private error: string | null = null;
  @state() private inlineAlbumId: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.tryLoad();
  }

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("token") && this.token) void this.tryLoad();
  }

  private async tryLoad(passwordOverride?: string) {
    try {
      const data = await api<SharePayload>(`/share/${this.token}`, {
        sharePassword: passwordOverride ?? undefined,
      });
      this.payload = data;
      this.needsPassword = false;
      this.wrongPassword = false;
      this.error = null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        const body = e.body as {
          requiresPassword?: boolean;
          wrongPassword?: boolean;
        };
        if (body?.requiresPassword) {
          this.needsPassword = true;
          this.wrongPassword = Boolean(body.wrongPassword);
          return;
        }
      }
      this.error =
        e instanceof ApiError
          ? e.status === 404
            ? "Share link not found or has been revoked."
            : e.message
          : "Failed to load.";
    }
  }

  private onSubmitPassword(e: SubmitEvent) {
    e.preventDefault();
    void this.tryLoad(this.password);
  }

  override render() {
    if (this.error) {
      return html`<wa-callout variant="danger">${this.error}</wa-callout>`;
    }
    if (this.needsPassword) return this.renderPassword();
    if (!this.payload) return html`<wa-spinner></wa-spinner>`;
    if (this.payload.type === "album") {
      return html`<sb-album-view .detail=${this.payload}></sb-album-view>`;
    }
    if (this.inlineAlbumId) {
      return html`<sb-album-view
        .albumId=${this.inlineAlbumId}
      ></sb-album-view>`;
    }
    const { folder, albums } = this.payload;
    return html`
      <h1>${folder.name}</h1>
      <div class="folder-grid">
        ${albums.map(
          (a) => html`
            <wa-card @click=${() => (this.inlineAlbumId = a.id)}>
              ${a.title}
            </wa-card>
          `,
        )}
      </div>
    `;
  }

  private renderPassword() {
    return html`
      <wa-card class="password-card">
        <h1>Password required</h1>
        ${this.wrongPassword
          ? html`<wa-callout variant="danger" size="small">
              Wrong password — try again.
            </wa-callout>`
          : null}
        <form @submit=${this.onSubmitPassword}>
          <wa-input
            type="password"
            required
            placeholder="Enter password"
            .value=${this.password}
            @input=${(e: Event) =>
              (this.password = (e.target as HTMLInputElement).value)}
          ></wa-input>
          <wa-button type="submit" variant="brand">Unlock</wa-button>
        </form>
      </wa-card>
    `;
  }
}
