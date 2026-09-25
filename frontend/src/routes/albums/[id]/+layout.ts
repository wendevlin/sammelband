import { load as get } from '$lib/api';
import type { AlbumDetail, Folder } from '$lib/types';

export const load = async ({ params, fetch, depends, parent }) => {
	// Wait for the root layout's auth/onboarding gate before hitting the API.
	await parent();
	depends(`app:album:${params.id}`);
	const [detail, folders] = await Promise.all([
		get<AlbumDetail>(`/albums/${params.id}`, fetch),
		get<Folder[]>('/folders', fetch)
	]);
	return { ...detail, folders };
};
