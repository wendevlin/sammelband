<script lang="ts">
import { page } from "$app/state";
import { auth } from "$lib/stores/auth.svelte";
import { cn } from "$lib/utils";

let { children } = $props();

const tabs = $derived([
  { href: "/admin/users", label: "Users" },
  { href: "/admin/storage", label: "Storage" },
  ...(auth.isSuperadmin && auth.multiTenant
    ? [{ href: "/admin/instance", label: "Sammelbände" }]
    : []),
]);
</script>

<p class="mb-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
  Admin settings
</p>
<nav class="mb-8 flex gap-1 border-b">
  {#each tabs as tab (tab.href)}
    <a
      href={tab.href}
      class={cn(
        '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        page.url.pathname === tab.href
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {tab.label}
    </a>
  {/each}
</nav>
{@render children()}
