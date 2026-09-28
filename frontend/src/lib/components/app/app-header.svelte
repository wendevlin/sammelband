<script lang="ts">
import LogOut from "@lucide/svelte/icons/log-out";
import Menu from "@lucide/svelte/icons/menu";
import Moon from "@lucide/svelte/icons/moon";
import Sun from "@lucide/svelte/icons/sun";
import SunMoon from "@lucide/svelte/icons/sun-moon";
import UserIcon from "@lucide/svelte/icons/user";
import { mode, setMode } from "mode-watcher";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { auth } from "$lib/stores/auth.svelte";
import { cn } from "$lib/utils";
import Logo from "./logo.svelte";

const links = $derived([
  { href: "/", label: "Library", active: !page.url.pathname.startsWith("/admin") },
  ...(auth.isAdmin
    ? [
        { href: "/admin/users", label: "Users", active: page.url.pathname === "/admin/users" },
        {
          href: "/admin/storage",
          label: "Storage",
          active: page.url.pathname === "/admin/storage",
        },
      ]
    : []),
  ...(auth.isSuperadmin
    ? [
        {
          href: "/admin/instance",
          label: "Sammelbände",
          active: page.url.pathname === "/admin/instance",
        },
      ]
    : []),
]);

const themes = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: SunMoon },
] as const;

async function signOut() {
  await auth.signOut();
  await goto("/login", { invalidateAll: true });
}
</script>

{#snippet themeItems()}
  {#each themes as t (t.value)}
    <DropdownMenu.Item onclick={() => setMode(t.value)}><t.icon /> {t.label}</DropdownMenu.Item>
  {/each}
{/snippet}

{#snippet accountLabel()}
  <DropdownMenu.Label>
    <div class="text-sm">{auth.user?.name}</div>
    <div class="text-xs font-normal text-muted-foreground">{auth.user?.email}</div>
    {#if auth.tenant}
      <div class="mt-1 text-xs font-normal text-muted-foreground">{auth.tenant.name}</div>
    {/if}
  </DropdownMenu.Label>
{/snippet}

<header class="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
  <div class="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
    <a href="/" aria-label="Library" class="shrink-0"><Logo /></a>

    <!-- Desktop: inline nav, theme and account menus. -->
    <nav class="hidden items-center gap-1 sm:flex">
      {#each links as link (link.href)}
        <a
          href={link.href}
          class={cn(
            'px-3 py-2 text-xs font-semibold tracking-widest uppercase transition-colors',
            link.active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {link.label}
        </a>
      {/each}
    </nav>
    <div class="ml-auto hidden items-center gap-1 sm:flex">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label="Theme">
              {#if mode.current === 'dark'}
                <Moon />
              {:else}
                <Sun />
              {/if}
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">{@render themeItems()}</DropdownMenu.Content>
      </DropdownMenu.Root>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label="Account">
              <UserIcon />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-56">
          {@render accountLabel()}
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={signOut}><LogOut /> Sign out</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>

    <!-- Mobile: everything behind one hamburger menu. -->
    <div class="ml-auto sm:hidden">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="ghost" size="icon" aria-label="Menu">
              <Menu class="size-5" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-64">
          {#each links as link (link.href)}
            <DropdownMenu.Item
              class={cn('py-2.5 text-base', link.active && 'font-semibold text-primary')}
            >
              {#snippet child({ props })}
                <a href={link.href} {...props}>{link.label}</a>
              {/snippet}
            </DropdownMenu.Item>
          {/each}
          <DropdownMenu.Separator />
          <DropdownMenu.Label class="text-xs font-normal text-muted-foreground"
            >Theme</DropdownMenu.Label
          >
          {@render themeItems()}
          <DropdownMenu.Separator />
          {@render accountLabel()}
          <DropdownMenu.Item onclick={signOut} class="py-2.5"
            ><LogOut />
            Sign out</DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>
</header>
