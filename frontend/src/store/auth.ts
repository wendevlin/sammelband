import { api, apiJSON } from "../api";

export type User = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  emailVerified: boolean;
};

export type AuthState = {
  status: "loading" | "anonymous" | "authenticated";
  user: User | null;
};

class AuthStore extends EventTarget {
  state: AuthState = { status: "loading", user: null };

  async refresh(): Promise<void> {
    try {
      const session = await api<{ user?: User } | null>("/auth/get-session");
      if (session?.user) {
        this.state = { status: "authenticated", user: session.user };
      } else {
        this.state = { status: "anonymous", user: null };
      }
    } catch {
      this.state = { status: "anonymous", user: null };
    }
    this.dispatchEvent(new Event("change"));
  }

  async signIn(email: string, password: string): Promise<void> {
    await apiJSON("/auth/sign-in/email", { email, password });
    await this.refresh();
  }

  async requestMagicLink(email: string): Promise<void> {
    await apiJSON("/auth/sign-in/magic-link", {
      email,
      callbackURL: "/home",
    });
  }

  async signOut(): Promise<void> {
    await apiJSON("/auth/sign-out", {});
    await this.refresh();
  }
}

export const auth = new AuthStore();
