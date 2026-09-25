<script lang="ts">
	import { goto } from '$app/navigation';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import Trash from '@lucide/svelte/icons/trash-2';
	import { del, patch, post } from '$lib/api';
	import { attempt } from '$lib/attempt';
	import ConfirmDialog from '$lib/components/app/confirm-dialog.svelte';
	import SimpleSelect from '$lib/components/app/simple-select.svelte';
	import BlockEditor from '$lib/components/editor/block-editor.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Textarea } from '$lib/components/ui/textarea';
	import { imageSrc } from '$lib/images';
	import type { Folder } from '$lib/types';
	import { cn } from '$lib/utils';

	let { data } = $props();

	// Metadata drafts; refreshed from the server while there are no unsaved edits.
	let title = $state('');
	let description = $state('');
	let folderId = $state('');
	let dirty = $state(false);
	let saving = $state(false);
	let deleteOpen = $state(false);

	$effect(() => {
		const a = data.album;
		if (dirty) return;
		title = a.title;
		description = a.description ?? '';
		folderId = a.folder_id ?? '';
	});

	function pathOf(f: Folder): string {
		const names = [f.name];
		let parent = data.folders.find((x) => x.id === f.parent_id);
		while (parent) {
			names.unshift(parent.name);
			const next: string | null = parent.parent_id;
			parent = data.folders.find((x) => x.id === next);
		}
		return names.join(' / ');
	}

	const folderOptions = $derived([
		{ value: '', label: 'Library (no folder)' },
		...data.folders
			.map((f) => ({ value: f.id, label: pathOf(f) }))
			.sort((a, b) => a.label.localeCompare(b.label))
	]);

	async function saveMeta(e?: SubmitEvent) {
		e?.preventDefault();
		saving = true;
		const ok = await attempt(
			() =>
				patch(`/albums/${data.album.id}`, {
					title: title.trim(),
					description: description.trim() || null,
					folderId: folderId || null
				}),
			'Saved'
		);
		saving = false;
		if (ok) dirty = false;
	}

	const setCover = (photoId: string | null) =>
		attempt(() => post(`/albums/${data.album.id}/cover`, { photoId }));

	async function deleteAlbum() {
		const ok = await attempt(() => del(`/albums/${data.album.id}`), 'Album deleted');
		if (ok) await goto(data.album.folder_id ? `/folders/${data.album.folder_id}` : '/');
	}
</script>

<svelte:head><title>Edit {data.album.title} · Sammelband</title></svelte:head>

<div class="mb-6 flex items-center justify-between gap-4">
	<Button variant="ghost" href="/albums/{data.album.id}"><ArrowLeft /> View album</Button>
	<Button variant="destructive" onclick={() => (deleteOpen = true)}><Trash /> Delete album</Button>
</div>

<Card.Root class="mb-8">
	<Card.Content>
		<form class="grid gap-4" onsubmit={saveMeta} oninput={() => (dirty = true)}>
			<div class="grid gap-4 sm:grid-cols-[1fr_auto]">
				<div class="grid gap-2">
					<Label for="title">Title</Label>
					<Input id="title" bind:value={title} required maxlength={200} />
				</div>
				<div class="grid gap-2">
					<Label>Folder</Label>
					<SimpleSelect
						label="Folder"
						value={folderId}
						options={folderOptions}
						onchange={(v) => {
							folderId = v;
							dirty = true;
						}}
						class="w-64"
					/>
				</div>
			</div>
			<div class="grid gap-2">
				<Label for="description">Description</Label>
				<Textarea id="description" bind:value={description} rows={2} placeholder="Optional" />
			</div>
			{#if dirty}
				<div class="flex justify-end gap-2">
					<Button variant="outline" onclick={() => (dirty = false)}>Discard</Button>
					<Button type="submit" disabled={saving || !title.trim()}>Save</Button>
				</div>
			{/if}
		</form>
	</Card.Content>
</Card.Root>

<Tabs.Root value="content">
	<Tabs.List class="mb-6">
		<Tabs.Trigger value="content">Content</Tabs.Trigger>
		<Tabs.Trigger value="cover">Cover</Tabs.Trigger>
	</Tabs.List>
	<Tabs.Content value="content">
		<BlockEditor albumId={data.album.id} blocks={data.blocks} photos={data.photos} />
	</Tabs.Content>
	<Tabs.Content value="cover">
		<p class="mb-4 text-sm text-muted-foreground">
			Without a chosen cover the album shows its first image.
		</p>
		{#if data.photos.length === 0}
			<p class="border border-dashed px-6 py-10 text-center text-muted-foreground">
				No photos yet. Add some to a gallery first.
			</p>
		{:else}
			<Button
				variant={data.album.cover_photo_id ? 'outline' : 'default'}
				size="sm"
				class="mb-4"
				onclick={() => setCover(null)}
			>
				{#if !data.album.cover_photo_id}<Check />{/if} Automatic
			</Button>
			<div class="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
				{#each data.photos as p (p.id)}
					<button
						type="button"
						class={cn(
							'relative aspect-square overflow-hidden bg-muted outline-offset-2',
							data.album.cover_photo_id === p.id && 'outline-3 outline-primary'
						)}
						onclick={() => setCover(p.id)}
						aria-label="Use as cover"
					>
						<img
							src={imageSrc(p.filename, 400)}
							alt={p.caption ?? ''}
							class="size-full object-cover"
						/>
					</button>
				{/each}
			</div>
		{/if}
	</Tabs.Content>
</Tabs.Root>

<ConfirmDialog
	bind:open={deleteOpen}
	title="Delete “{data.album.title}”?"
	description="The album, its blocks and all its photos are deleted. This cannot be undone."
	onconfirm={deleteAlbum}
/>
