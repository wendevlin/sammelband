import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "./api";
import { navigate, parseRoute, type Route } from "./router";
import { auth } from "./store/auth";
import { type ThemeMode, theme } from "./theme";

// Side-effect imports: Web Awesome components + theme controller singleton.
import "./webawesome";

// Page imports (define the custom elements as a side-effect).
import "./pages/sb-login";
import "./pages/sb-onboarding";
import "./pages/sb-home";
import "./pages/sb-folder-view";
import "./pages/sb-album-view";
import "./pages/sb-share-view";
import "./pages/admin/sb-admin-home";
import "./pages/admin/sb-admin-users";
import "./pages/admin/sb-album-edit";
import "./pages/admin/sb-storage";

@customElement("sb-app")
export class SbApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--wa-space-m) var(--wa-space-l);
      border-bottom: 1px solid var(--wa-color-surface-border);
      background: var(--wa-color-surface-raised);
    }
    header a.brand {
      font-weight: var(--wa-font-weight-bold);
      font-size: var(--wa-font-size-l);
      color: var(--wa-color-text-normal);
    }
    nav {
      display: flex;
      gap: var(--wa-space-m);
      align-items: center;
      font-size: var(--wa-font-size-s);
    }
    nav .who {
      color: var(--wa-color-text-quiet);
    }
    main {
      padding: var(--wa-space-l);
      max-width: 1200px;
      margin: 0 auto;
    }
    .loading {
      padding: var(--wa-space-xl);
      color: var(--wa-color-text-quiet);
    }
  `;

  @state() private route: Route = parseRoute(location.pathname);
  @state() private authState = auth.state;
  @state() private needsOnboarding: boolean | null = null;
  @state() private themeMode: ThemeMode = theme.mode;

  override connectedCallback(): void {
    super.connectedCallback();
    addEventListener("popstate", this.onPop);
    auth.addEventListener("change", this.onAuthChange);
    theme.addEventListener("change", this.onThemeChange);
    void this.checkOnboarding();
    void auth.refresh();
  }

  private async checkOnboarding() {
    try {
      const s = await api<{ needsOnboarding: boolean }>("/onboarding/status");
      this.needsOnboarding = s.needsOnboarding;
    } catch {
      this.needsOnboarding = false;
    }
  }

  override disconnectedCallback(): void {
    removeEventListener("popstate", this.onPop);
    auth.removeEventListener("change", this.onAuthChange);
    theme.removeEventListener("change", this.onThemeChange);
    super.disconnectedCallback();
  }

  private onPop = () => {
    this.route = parseRoute(location.pathname);
  };

  private onAuthChange = () => {
    this.authState = { ...auth.state };
  };

  private onThemeChange = () => {
    this.themeMode = theme.mode;
  };

  private async onSignOut() {
    await auth.signOut();
    navigate("/login");
  }

  private renderThemeToggle() {
    const icon =
      this.themeMode === "light"
        ? "sun"
        : this.themeMode === "dark"
          ? "moon"
          : "circle-half-stroke";
    return html`
      <wa-dropdown placement="bottom-end">
        <wa-button slot="trigger" appearance="plain" size="small" with-caret>
          <wa-icon name=${icon}></wa-icon>
        </wa-button>
        <wa-dropdown-item
          type="checkbox"
          ?checked=${this.themeMode === "light"}
          @click=${() => (theme.mode = "light")}
        >
          Light
        </wa-dropdown-item>
        <wa-dropdown-item
          type="checkbox"
          ?checked=${this.themeMode === "dark"}
          @click=${() => (theme.mode = "dark")}
        >
          Dark
        </wa-dropdown-item>
        <wa-dropdown-item
          type="checkbox"
          ?checked=${this.themeMode === "system"}
          @click=${() => (theme.mode = "system")}
        >
          System
        </wa-dropdown-item>
      </wa-dropdown>
    `;
  }

  override render() {
    // Wait until both onboarding-status and auth-refresh land so we don't flash
    // the login screen before catching the no-admins case.
    if (this.needsOnboarding === null || this.authState.status === "loading") {
      return html`<div class="loading">Loading…</div>`;
    }

    // First-run onboarding takes over the entire UI until claimed.
    if (this.needsOnboarding) {
      return html`<sb-onboarding
        @onboarding-complete=${() => (this.needsOnboarding = false)}
      ></sb-onboarding>`;
    }

    // Public route: share view does not require auth.
    if (this.route.name === "share") {
      return html`<sb-share-view .token=${this.route.token}></sb-share-view>`;
    }

    // Everything else requires a session.
    if (this.authState.status === "anonymous") {
      if (this.route.name !== "login") {
        // Don't push state during render; let the side-effect run on next tick.
        queueMicrotask(() => navigate("/login"));
        return html`<div class="loading">Redirecting…</div>`;
      }
      return html`<sb-login></sb-login>`;
    }

    return html`
      <header>
        <a class="brand" href="/home" @click=${this.linkClick("/home")}
          >Sammelband</a
        >
        <nav>
          ${this.authState.user?.role === "admin"
            ? html`<a href="/admin" @click=${this.linkClick("/admin")}
                >Admin</a
              >`
            : null}
          <span class="who">${this.authState.user?.email}</span>
          ${this.renderThemeToggle()}
          <wa-button appearance="plain" size="small" @click=${this.onSignOut}>
            Sign out
          </wa-button>
        </nav>
      </header>
      <main>${this.renderRoute()}</main>
    `;
  }

  private renderRoute() {
    switch (this.route.name) {
      case "home":
        return html`<sb-home></sb-home>`;
      case "folder":
        return html`<sb-folder-view
          .folderId=${this.route.id}
        ></sb-folder-view>`;
      case "album":
        return html`<sb-album-view .albumId=${this.route.id}></sb-album-view>`;
      case "login":
        return html`<sb-login></sb-login>`;
      case "admin-home":
      case "admin-album":
      case "admin-storage":
      case "admin-users":
        if (this.authState.user?.role !== "admin") {
          return html`<p>Admin only.</p>`;
        }
        if (this.route.name === "admin-home")
          return html`<sb-admin-home></sb-admin-home>`;
        if (this.route.name === "admin-album") {
          return html`<sb-album-edit
            .albumId=${this.route.id}
          ></sb-album-edit>`;
        }
        if (this.route.name === "admin-users")
          return html`<sb-admin-users></sb-admin-users>`;
        return html`<sb-storage></sb-storage>`;
      default:
        return html`<p>Page not found.</p>`;
    }
  }

  private linkClick(to: string) {
    return (e: MouseEvent) => {
      e.preventDefault();
      navigate(to);
    };
  }
}
