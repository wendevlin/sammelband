import { api, post } from '$lib/api';
import type { Role } from '$lib/types';

export type SessionUser = {
	id: string;
	email: string;
	name: string;
	role: Role;
};

class AuthStore {
	user = $state<SessionUser | null>(null);
	needsOnboarding = $state(false);
	#initialized = false;

	get isAdmin(): boolean {
		return this.user?.role === 'admin';
	}

	/** Runs once per page load (root layout load). */
	async init(): Promise<void> {
		if (this.#initialized) return;
		this.#initialized = true;
		const [status] = await Promise.all([
			api<{ needsOnboarding: boolean }>('/onboarding/status').catch(() => ({
				needsOnboarding: false
			})),
			this.refresh()
		]);
		this.needsOnboarding = status.needsOnboarding;
	}

	async refresh(): Promise<void> {
		try {
			const session = await api<{ user?: SessionUser } | null>('/auth/get-session');
			this.user = session?.user
				? { ...session.user, role: session.user.role === 'admin' ? 'admin' : 'user' }
				: null;
		} catch {
			this.user = null;
		}
	}

	async signIn(email: string, password: string): Promise<void> {
		await post('/auth/sign-in/email', { email, password });
		await this.refresh();
	}

	async signOut(): Promise<void> {
		await post('/auth/sign-out');
		this.user = null;
	}
}

export const auth = new AuthStore();
