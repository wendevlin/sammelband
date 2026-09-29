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
  /** Signs in with a code from an authenticator app. */
  twoFactorEnabled: boolean;
};

/** A sign-in with the password: done, or waiting for the second factor. */
export type SignInResult = "signed-in" | "two-factor";

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

  /** Two-factor authentication is required here, and the user hasn't set it up yet. */
  get needsTwoFactorSetup(): boolean {
    if (!this.user || this.user.twoFactorEnabled) return false;
    return Boolean(
      this.tenant?.two_factor_required || this.tenant?.two_factor_required_by_instance,
    );
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
            twoFactorEnabled: session.user.twoFactorEnabled === true,
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

  async signIn(email: string, password: string): Promise<SignInResult> {
    const res = await post<{ twoFactorRedirect?: boolean }>("/auth/sign-in/email", {
      email,
      password,
    });
    if (res.twoFactorRedirect) return "two-factor";
    await this.refresh();
    return "signed-in";
  }

  /** Second step of a sign-in: a code from the app, or a backup code. */
  async verifyCode(code: string, opts: { backup: boolean; trustDevice: boolean }): Promise<void> {
    const path = opts.backup
      ? "/auth/two-factor/verify-backup-code"
      : "/auth/two-factor/verify-totp";
    await post(path, { code: code.replace(/\s/g, ""), trustDevice: opts.trustDevice });
    await this.refresh();
  }

  async signOut(): Promise<void> {
    await post("/auth/sign-out");
    this.user = null;
    this.tenant = null;
  }
}

export const auth = new AuthStore();
