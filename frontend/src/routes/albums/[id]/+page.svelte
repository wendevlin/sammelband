<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import AlbumContent from '$lib/components/album/album-content.svelte';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb';
	import { Button } from '$lib/components/ui/button';
	import type { Folder } from '$lib/types';

	let { data } = $props();

	const trail = $derived.by(() => {
		const chain: Folder[] = [];
		let current = data.folders.find((f) => f.id === data.album.folder_id) ?? null;
		while (current) {
			chain.unshift(current);
			const parentId: string | null = current.parent_id;
			current = data.folders.find((f) => f.id === parentId) ?? null;
		}
		return chain;
	});
</script>

<svelte:head><title>{data.album.title} · Sammelband</title></svelte:head>

<article class="mx-auto max-w-4xl">
	<div class="mb-10 flex flex-wrap items-start justify-between gap-4">
		<div>
			<Breadcrumb.Root class="mb-3">
				<Breadcrumb.List>
					<Breadcrumb.Item><Breadcrumb.Link href="/">Library</Breadcrumb.Link></Breadcrumb.Item>
					{#each trail as f (f.id)}
						<Breadcrumb.Separator />
						<Breadcrumb.Item>
							<Breadcrumb.Link href="/folders/{f.id}">{f.name}</Breadcrumb.Link>
						</Breadcrumb.Item>
					{/each}
				</Breadcrumb.List>
			</Breadcrumb.Root>
			<h1 class="font-heading text-5xl leading-tight">{data.album.title}</h1>
			{#if data.album.description}
				<p class="mt-4 max-w-2xl text-lg text-muted-foreground">{data.album.description}</p>
			{/if}
		</div>
		<Button variant="outline" href="/albums/{data.album.id}/edit"><Pencil /> Edit</Button>
	</div>
	<AlbumContent blocks={data.blocks} photos={data.photos} />
</article>
