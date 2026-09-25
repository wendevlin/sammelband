import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ApiError, apiJSON } from "../api";
import { navigate } from "../router";
import { auth } from "../store/auth";

@customElement("sb-onboarding")
export class SbOnboarding extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: var(--wa-space-l);
    }
    wa-card {
      max-width: 460px;
      width: 100%;
    }
    h1 {
      margin: 0 0 var(--wa-space-xs);
    }
    .intro {
      color: var(--wa-color-text-quiet);
      margin-bottom: var(--wa-space-m);
    }
    .intro code {
      background: var(--wa-color-surface-lowered);
      padding: 0.1rem 0.4rem;
      border-radius: var(--wa-border-radius-s);
      font-family: var(--wa-font-family-code);
      font-size: 0.9em;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: var(--wa-space-m);
    }
    wa-input.code-input::part(input) {
      font-family: var(--wa-font-family-code);
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    .error {
      color: var(--wa-color-danger-on-quiet);
      font-size: var(--wa-font-size-s);
    }
  `;

  @state() private code = "";
  @state() private email = "";
  @state() private password = "";
  @state() private name = "";
  @state() private busy = false;
  @state() private error: string | null = null;
  /** True when the code came from the ?code= query param — we hide the field. */
  @state() private codeFromUrl = false;

  override connectedCallback(): void {
    super.connectedCallback();
    const fromUrl = new URLSearchParams(location.search).get("code");
    if (fromUrl) {
      this.code = fromUrl.toUpperCase();
      this.codeFromUrl = true;
    }
  }

  private async onSubmit(e: SubmitEvent) {
    e.preventDefault();
    this.busy = true;
    this.error = null;
    try {
      await apiJSON("/onboarding/claim", {
        code: this.code,
        email: this.email,
        password: this.password,
        name: this.name || this.email,
      });
      await auth.signIn(this.email, this.password);
      this.dispatchEvent(
        new CustomEvent("onboarding-complete", {
          bubbles: true,
          composed: true,
        }),
      );
      navigate("/admin");
    } catch (err) {
      this.error =
        err instanceof ApiError ? err.message : "Something went wrong";
      if (err instanceof ApiError && err.status === 401 && this.codeFromUrl) {
        this.codeFromUrl = false;
      }
    } finally {
      this.busy = false;
    }
  }

  override render() {
    return html`
      <wa-card>
        <h1>Welcome to Sammelband</h1>
        <p class="intro">
          ${this.codeFromUrl
            ? html`Bootstrap code accepted from URL. Create your admin account
              below.`
            : html`No admin account exists yet. Enter the bootstrap
                <code>code</code> printed in your server terminal to create the
                first admin.`}
        </p>
        <form @submit=${this.onSubmit}>
          ${this.codeFromUrl
            ? null
            : html`<wa-input
                class="code-input"
                label="Bootstrap code"
                required
                autocomplete="off"
                spellcheck="false"
                .value=${this.code}
                @input=${(e: Event) =>
                  (this.code = (e.target as HTMLInputElement).value)}
              ></wa-input>`}
          <wa-input
            label="Name"
            .value=${this.name}
            @input=${(e: Event) =>
              (this.name = (e.target as HTMLInputElement).value)}
          ></wa-input>
          <wa-input
            label="Email"
            type="email"
            required
            .value=${this.email}
            @input=${(e: Event) =>
              (this.email = (e.target as HTMLInputElement).value)}
          ></wa-input>
          <wa-input
            label="Password"
            type="password"
            password-toggle
            required
            minlength="8"
            .value=${this.password}
            @input=${(e: Event) =>
              (this.password = (e.target as HTMLInputElement).value)}
          ></wa-input>
          ${this.error ? html`<p class="error">${this.error}</p>` : null}
          <wa-button type="submit" variant="brand" ?loading=${this.busy}>
            Create admin account
          </wa-button>
        </form>
      </wa-card>
    `;
  }
}
