<script lang="ts">
import { navigating } from "$app/state";
import { m } from "$lib/paraglide/messages.js";

// Thin bar at the top while a navigation's load functions run. It waits a
// moment before appearing so fast (preloaded) navigations don't flash it.
let visible = $state(false);

$effect(() => {
  if (!navigating.to) {
    visible = false;
    return;
  }
  const timer = setTimeout(() => (visible = true), 120);
  return () => clearTimeout(timer);
});
</script>

{#if visible}
  <div
    class="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/20"
    role="progressbar"
    aria-label={m.loading_page()}
  >
    <div class="nav-progress h-full w-1/3 bg-primary"></div>
  </div>
{/if}

<style>
.nav-progress {
  animation: nav-progress 1.1s ease-in-out infinite;
}
@keyframes nav-progress {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
</style>
