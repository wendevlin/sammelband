import { load as get } from '$lib/api';
import type { StorageStats } from '$lib/types';

export const load = async ({ fetch, depends, parent }) => {
	// Wait for the root layout's auth/onboarding gate before hitting the API.
	await parent();
	depends('app:storage');
	return { stats: await get<StorageStats>('/admin/storage', fetch) };
};
