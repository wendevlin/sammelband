import type { Role, TenantInfo } from "@sammelband/shared";
import { api, post } from "$lib/api";
import { applyAccountLocale } from "$lib/i18n";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  /** Role within the user's Sammelband. */
  role: Role;
  tenantId: string;
  superadmin: boolean;
  /** Avatar URL, or null. */
  image: string | null;
  /** UI language saved with the account; null follows the browser. */
  locale: string | null;
};

class AuthStore {
  user = $state<SessionUser | null>(null);
  /** The user's Sammelband. */
  tenant = $state<TenantInfo | null>(null);
  needsOnboarding = $state(false);
  /** The server hosts several Sammelbände (MULTI_TENANT=true). */
  multiTenant = $state(false);
  #initialized = false;

  get isAdmin(): boolean {
    return this.user?.role === "admin";
  }

  get isSuperadmin(): boolean {
    return this.user?.superadmin === true;
  }

  /** Runs once per page load (root layout load). */
  async init(): Promise<void> {
    if (this.#initialized) return;
    this.#initialized = true;
    const [status] = await Promise.all([
      api<{ needsOnboarding: boolean; multiTenant: boolean }>("/onboarding/status").catch(() => ({
        needsOnboarding: false,
        multiTenant: false,
      })),
      this.refresh(),
    ]);
    this.needsOnboarding = status.needsOnboarding;
    this.multiTenant = status.multiTenant;
  }

  async refresh(): Promise<void> {
    try {
      const session = await api<{ user?: SessionUser } | null>("/auth/get-session");
      this.user = session?.user
        ? {
            ...session.user,
            role: session.user.role === "admin" ? "admin" : "user",
            superadmin: session.user.superadmin === true,
          }
        : null;
      this.tenant = this.user ? await api<TenantInfo>("/tenant").catch(() => null) : null;
      // The account's language wins over this browser's (reloads if it differs).
      applyAccountLocale(this.user?.locale);
    } catch {
      this.user = null;
      this.tenant = null;
    }
  }

  async signIn(email: string, password: string): Promise<void> {
    await post("/auth/sign-in/email", { email, password });
    await this.refresh();
  }

  async signOut(): Promise<void> {
    await post("/auth/sign-out");
    this.user = null;
    this.tenant = null;
  }
}

export const auth = new AuthStore();
