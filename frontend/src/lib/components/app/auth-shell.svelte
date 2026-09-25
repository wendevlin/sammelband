<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card';

	let { title, description, children }: { title: string; description?: string; children: Snippet } =
		$props();
</script>

<div class="flex min-h-svh items-center justify-center px-4">
	<div class="w-full max-w-sm">
		<p class="mb-6 text-center font-heading text-3xl">Sammelband</p>
		<Card.Root>
			<Card.Header>
				<Card.Title>{title}</Card.Title>
				{#if description}<Card.Description>{description}</Card.Description>{/if}
			</Card.Header>
			<Card.Content>{@render children()}</Card.Content>
		</Card.Root>
	</div>
</div>
