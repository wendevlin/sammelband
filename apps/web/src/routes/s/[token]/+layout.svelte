<script lang="ts">
import Logo from "#lib/components/app/logo.svelte";
import { setMediaBase } from "#lib/images.ts";
import { page } from "$app/state";

let { children } = $props();

// Images and videos of a shared album come through the link's own routes.
setMediaBase(`/api/public/${page.params.token}`);
</script>

<svelte:head><meta name="robots" content="noindex, nofollow"></svelte:head>

<header class="border-b">
  <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
    <Logo class="size-7" />
    <span class="font-heading text-lg text-primary">Sammelband</span>
  </div>
</header>
<main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">{@render children()}</main>
