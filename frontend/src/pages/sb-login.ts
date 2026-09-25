import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ApiError } from "../api";
import { navigate } from "../router";
import { auth } from "../store/auth";

type Mode = "signin" | "magic";

@customElement("sb-login")
export class SbLogin extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      place-items: center;
      min-height: 80vh;
      padding: var(--wa-space-l);
    }
    wa-card {
      width: 100%;
      max-width: 400px;
    }
    h1 {
      margin: 0 0 var(--wa-space-m);
      font-size: var(--wa-font-size-xl);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    .tabs {
      display: flex;
      justify-content: center;
      margin-top: var(--wa-space-xs);
    }
    .error {
      color: var(--wa-color-danger-on-quiet);
      font-size: var(--wa-font-size-s);
    }
    .info {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
    }
  `;

  @state() private mode: Mode = "signin";
  @state() private email = "";
  @state() private password = "";
  @state() private error: string | null = null;
  @state() private info: string | null = null;
  @state() private busy = false;

  private async onSubmit(e: SubmitEvent) {
    e.preventDefault();
    this.error = null;
    this.info = null;
    this.busy = true;
    try {
      if (this.mode === "signin") {
        await auth.signIn(this.email, this.password);
        navigate("/home");
      } else {
        await auth.requestMagicLink(this.email);
        this.info = "Check your inbox for a login link.";
      }
    } catch (err) {
      this.error =
        err instanceof ApiError ? err.message : "Something went wrong";
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const submitLabel = this.mode === "signin" ? "Sign in" : "Send magic link";
    return html`
      <wa-card>
        <h1>Sammelband</h1>
        <form @submit=${this.onSubmit}>
          <wa-input
            label="Email"
            type="email"
            required
            .value=${this.email}
            @input=${(e: Event) =>
              (this.email = (e.target as HTMLInputElement).value)}
          ></wa-input>
          ${this.mode === "magic"
            ? null
            : html`<wa-input
                label="Password"
                type="password"
                password-toggle
                required
                minlength="8"
                .value=${this.password}
                @input=${(e: Event) =>
                  (this.password = (e.target as HTMLInputElement).value)}
              ></wa-input>`}
          ${this.error ? html`<p class="error">${this.error}</p>` : null}
          ${this.info ? html`<p class="info">${this.info}</p>` : null}
          <wa-button type="submit" variant="brand" ?loading=${this.busy}>
            ${submitLabel}
          </wa-button>
        </form>
        <div class="tabs">
          <wa-button-group>
            ${(["signin", "magic"] as Mode[]).map(
              (m) => html`
                <wa-button
                  size="small"
                  variant=${this.mode === m ? "brand" : "neutral"}
                  appearance=${this.mode === m ? "accent" : "outlined"}
                  @click=${() => (this.mode = m)}
                >
                  ${m === "signin" ? "Sign in" : "Magic link"}
                </wa-button>
              `,
            )}
          </wa-button-group>
        </div>
      </wa-card>
    `;
  }
}
