<script lang="ts">
import { page } from "$app/state";
import { m } from "$lib/paraglide/messages.js";
import { auth } from "$lib/stores/auth.svelte";
import { cn } from "$lib/utils";

let { children } = $props();

const tabs = $derived([
  { href: "/admin/general", label: m.admin_tab_general() },
  { href: "/admin/users", label: m.admin_tab_users() },
  { href: "/admin/storage", label: m.admin_tab_storage() },
  ...(auth.isSuperadmin && auth.multiTenant
    ? [{ href: "/admin/instance", label: m.admin_tab_instance() }]
    : []),
]);
</script>

<p class="mb-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
  {m.nav_admin_settings()}
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
