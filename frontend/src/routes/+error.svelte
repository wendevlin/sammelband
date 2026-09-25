<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
</script>

<div class="flex flex-col items-center gap-4 py-24 text-center">
	<p class="text-sm tracking-widest text-muted-foreground uppercase">{page.status}</p>
	<h1 class="font-heading text-3xl">
		{page.status === 404 ? 'Not found' : (page.error?.message ?? 'Something went wrong')}
	</h1>
	<Button href="/" variant="outline">Back to the library</Button>
</div>
