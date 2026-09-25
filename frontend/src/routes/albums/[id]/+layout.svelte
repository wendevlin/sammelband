<script lang="ts">
	import { page } from '$app/state';
	import { live } from '$lib/live.svelte';

	let { children } = $props();

	live(
		() => [`album:${page.params.id}`],
		() => `app:album:${page.params.id}`
	);
</script>

{@render children()}
