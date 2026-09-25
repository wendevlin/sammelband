import { load as get } from '$lib/api';
import type { Album, Folder } from '$lib/types';

export const load = async ({ fetch, depends, parent }) => {
	// Wait for the root layout's auth/onboarding gate before hitting the API.
	await parent();
	depends('app:library');
	const [folders, albums] = await Promise.all([
		get<Folder[]>('/folders', fetch),
		get<Album[]>('/albums', fetch)
	]);
	return { folders, albums };
};
