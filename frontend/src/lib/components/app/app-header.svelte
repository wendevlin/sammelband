<script lang="ts">
import LogOut from "@lucide/svelte/icons/log-out";
import Menu from "@lucide/svelte/icons/menu";
import Moon from "@lucide/svelte/icons/moon";
import Settings from "@lucide/svelte/icons/settings";
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
import UserAvatar from "./user-avatar.svelte";

// Everything account- and admin-related lives in the account menu.
const inLibrary = $derived(
  !page.url.pathname.startsWith("/admin") && !page.url.pathname.startsWith("/profile"),
);

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

{#snippet accountItems(itemClass = '')}
  <DropdownMenu.Label class="flex items-center gap-3 tracking-normal normal-case">
    <UserAvatar name={auth.user?.name ?? ''} image={auth.user?.image} class="size-9 text-sm" />
    <div class="min-w-0">
      <div class="truncate text-sm">{auth.user?.name}</div>
      <div class="truncate text-xs font-normal text-muted-foreground">{auth.user?.email}</div>
      {#if auth.tenant}
        <div class="truncate text-xs font-normal text-muted-foreground">{auth.tenant.name}</div>
      {/if}
    </div>
  </DropdownMenu.Label>
  <DropdownMenu.Separator />
  <DropdownMenu.Item class={itemClass}>
    {#snippet child({ props })}
      <a href="/profile" {...props}><UserIcon /> Profile</a>
    {/snippet}
  </DropdownMenu.Item>
  {#if auth.isAdmin}
    <DropdownMenu.Item class={itemClass}>
      {#snippet child({ props })}
        <a href="/admin" {...props}><Settings /> Admin settings</a>
      {/snippet}
    </DropdownMenu.Item>
  {/if}
{/snippet}

<header class="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
  <div class="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
    <a href="/" aria-label="Library" class="shrink-0"><Logo /></a>

    <!-- Desktop: library link, theme and account menus. -->
    <nav class="hidden items-center gap-1 sm:flex">
      <a
        href="/"
        class={cn(
          'px-3 py-2 text-xs font-semibold tracking-widest uppercase transition-colors',
          inLibrary ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Library
      </a>
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
            <button {...props} type="button" class="ml-1 rounded-full" aria-label="Account">
              <UserAvatar name={auth.user?.name ?? ''} image={auth.user?.image} />
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-60">
          {@render accountItems()}
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
          <DropdownMenu.Item
            class={cn('py-2.5 text-base', inLibrary && 'font-semibold text-primary')}
          >
            {#snippet child({ props })}
              <a href="/" {...props}>Library</a>
            {/snippet}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          {@render accountItems('py-2.5 text-base')}
          <DropdownMenu.Separator />
          <DropdownMenu.Label class="text-xs font-normal text-muted-foreground"
            >Theme</DropdownMenu.Label
          >
          {@render themeItems()}
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={signOut} class="py-2.5"
            ><LogOut />
            Sign out</DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>
</header>
