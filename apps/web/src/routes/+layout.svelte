<script lang="ts">
import "./layout.css";
import { ModeWatcher } from "mode-watcher";
import { page } from "$app/state";
import favicon from "$lib/assets/favicon.svg";
import AppHeader from "$lib/components/app/app-header.svelte";
import NavProgress from "$lib/components/app/nav-progress.svelte";
import Onboarding from "$lib/components/app/onboarding.svelte";
import { Toaster } from "$lib/components/ui/sonner";
import { dragAutoscroll } from "$lib/drag-autoscroll";
import { setDocumentLanguage } from "$lib/i18n";
import { auth } from "$lib/stores/auth.svelte";

let { children } = $props();

// Every drag and drop in the app can reach off-screen targets.
$effect(() => dragAutoscroll());
$effect(() => setDocumentLanguage());
</script>

<svelte:head>
  <link rel="icon" href={favicon}>
  <title>Sammelband</title>
</svelte:head>

<ModeWatcher />
<NavProgress />
<Toaster richColors />

{#if page.url.pathname.startsWith('/s/')}
  <!-- Public link pages bring their own minimal layout, signed in or not. -->
  {@render children()}
{:else if auth.needsOnboarding}
  <Onboarding />
{:else if auth.user}
  <AppHeader />
  <main class="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
    {@render children()}
  </main>
{:else}
  {@render children()}
{/if}
