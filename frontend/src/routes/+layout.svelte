<script lang="ts">
import "./layout.css";
import { ModeWatcher } from "mode-watcher";
import favicon from "$lib/assets/favicon.svg";
import AppHeader from "$lib/components/app/app-header.svelte";
import NavProgress from "$lib/components/app/nav-progress.svelte";
import Onboarding from "$lib/components/app/onboarding.svelte";
import { Toaster } from "$lib/components/ui/sonner";
import { auth } from "$lib/stores/auth.svelte";

let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon}>
  <title>Sammelband</title>
</svelte:head>

<ModeWatcher />
<NavProgress />
<Toaster richColors />

{#if auth.needsOnboarding}
  <Onboarding />
{:else if auth.user}
  <AppHeader />
  <main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
    {@render children()}
  </main>
{:else}
  {@render children()}
{/if}
