import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ApiError, api, apiJSON } from "../../api";

type User = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  createdAt: number;
};

@customElement("sb-admin-users")
export class SbAdminUsers extends LitElement {
  static override styles = css`
    :host {
      display: block;
    }
    h1 {
      margin: 0 0 var(--wa-space-m);
      font-size: var(--wa-font-size-xl);
    }
    h2 {
      font-size: var(--wa-font-size-m);
      margin: 0 0 var(--wa-space-xs);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--wa-space-xs);
      align-items: end;
      margin-bottom: var(--wa-space-m);
    }
    .row wa-input {
      flex: 1;
      min-width: 12ch;
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

  @state() private users: User[] = [];
  @state() private name = "";
  @state() private email = "";
  @state() private password = "";
  @state() private newRole: "admin" | "user" = "user";
  @state() private error: string | null = null;
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    try {
      this.users = await api<User[]>("/admin/users");
    } catch (e) {
      console.error(e);
    }
  }

  private async create() {
    if (!this.email || !this.name || !this.password) {
      this.error = "Name, email and password are required.";
      return;
    }
    this.error = null;
    this.busy = true;
    try {
      await apiJSON("/admin/users", {
        name: this.name,
        email: this.email,
        password: this.password,
        role: this.newRole,
      });
      this.name = "";
      this.email = "";
      this.password = "";
      this.newRole = "user";
      await this.load();
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : "Failed to create user.";
    } finally {
      this.busy = false;
    }
  }

  private async setRole(u: User, role: "admin" | "user") {
    if (u.role === role) return;
    try {
      await api(`/admin/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      await this.load();
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : "Failed to update role.";
    }
  }

  override render() {
    return html`
      <h1>Users</h1>

      <wa-card>
        <h2>Create user</h2>
        <div class="row">
          <wa-input
            label="Name"
            .value=${this.name}
            @input=${(e: Event) =>
              (this.name = (e.target as HTMLInputElement).value)}
          ></wa-input>
          <wa-input
            label="Email"
            type="email"
            placeholder="user@example.com"
            .value=${this.email}
            @input=${(e: Event) =>
              (this.email = (e.target as HTMLInputElement).value)}
          ></wa-input>
          <wa-input
            label="Initial password"
            type="password"
            password-toggle
            minlength="8"
            .value=${this.password}
            @input=${(e: Event) =>
              (this.password = (e.target as HTMLInputElement).value)}
          ></wa-input>
          <wa-select
            label="Role"
            .value=${this.newRole}
            @input=${(e: Event) =>
              (this.newRole = (e.target as HTMLInputElement).value as
                | "admin"
                | "user")}
          >
            <wa-option value="user">User</wa-option>
            <wa-option value="admin">Admin</wa-option>
          </wa-select>
          <wa-button
            variant="brand"
            ?loading=${this.busy}
            @click=${this.create}
          >
            Create
          </wa-button>
        </div>
        ${this.error
          ? html`<wa-callout variant="danger" size="small"
              >${this.error}</wa-callout
            >`
          : null}
        <p class="muted">
          The user signs in with this email and the initial password (or via a
          magic link).
        </p>
      </wa-card>

      ${this.users.length === 0
        ? html`<p class="empty">No users yet.</p>`
        : html`<ul>
            ${this.users.map(
              (u) => html`
                <li>
                  <div class="who">
                    <div>${u.name}</div>
                    <div class="muted">${u.email}</div>
                  </div>
                  <wa-select
                    size="small"
                    .value=${u.role}
                    @input=${(e: Event) =>
                      this.setRole(
                        u,
                        (e.target as HTMLInputElement).value as
                          | "admin"
                          | "user",
                      )}
                  >
                    <wa-option value="user">User</wa-option>
                    <wa-option value="admin">Admin</wa-option>
                  </wa-select>
                </li>
              `,
            )}
          </ul>`}
    `;
  }
}
