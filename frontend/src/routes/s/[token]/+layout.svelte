<script lang="ts">
import { page } from "$app/state";
import Logo from "$lib/components/app/logo.svelte";
import { setImageBase } from "$lib/images";

let { children } = $props();

// Images of a shared album come through the link's own route.
setImageBase(`/api/public/${page.params.token}/images`);
</script>

<svelte:head><meta name="robots" content="noindex, nofollow"></svelte:head>

<header class="border-b">
  <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
    <Logo class="size-7" />
    <span class="font-heading text-lg text-primary">Sammelband</span>
  </div>
</header>
<main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{@render children()}</main>
