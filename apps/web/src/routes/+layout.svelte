<script lang="ts">
import "./layout.css";
import { ModeWatcher } from "mode-watcher";
import favicon from "#lib/assets/favicon.svg";
import AppHeader from "#lib/components/app/app-header.svelte";
import NavProgress from "#lib/components/app/nav-progress.svelte";
import Onboarding from "#lib/components/app/onboarding.svelte";
import { Toaster } from "#lib/components/ui/sonner/index.ts";
import { dragAutoscroll } from "#lib/drag-autoscroll.ts";
import { setDocumentLanguage } from "#lib/i18n.ts";
import { auth } from "#lib/stores/auth.svelte.ts";
import { page } from "$app/state";

let { children } = $props();

/** svelte-sonner's offsets: `gap`, or more where a safe area inset is wider. */
function toastOffset(gap: number) {
  const side = (inset: string) => `max(${gap}px, env(safe-area-inset-${inset}))`;
  return { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") };
}

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
<!-- viewport-fit=cover: toasts keep clear of the notch, the home indicator and Safari's toolbar. -->
<Toaster richColors offset={toastOffset(24)} mobileOffset={toastOffset(16)} />

{#if page.url.pathname.startsWith("/s/")}
  <!-- Public link pages bring their own minimal layout, signed in or not. -->
  {@render children()}
{:else if auth.needsOnboarding}
  <Onboarding />
{:else if auth.user && !auth.needsTwoFactorSetup}
  <AppHeader />
  <main class="mx-auto w-full max-w-6xl px-safe-4 pt-8 pb-safe-8 sm:px-safe-6">
    {@render children()}
  </main>
{:else}
  {@render children()}
{/if}
