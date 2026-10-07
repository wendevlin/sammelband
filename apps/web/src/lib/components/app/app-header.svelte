<script lang="ts">
import LogOut from "@lucide/svelte/icons/log-out";
import Menu from "@lucide/svelte/icons/menu";
import Moon from "@lucide/svelte/icons/moon";
import Settings from "@lucide/svelte/icons/settings";
import Sun from "@lucide/svelte/icons/sun";
import SunMoon from "@lucide/svelte/icons/sun-moon";
import UserIcon from "@lucide/svelte/icons/user";
import { mode, setMode } from "mode-watcher";
import { Button } from "#lib/components/ui/button/index.ts";
import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.ts";
import { m } from "#lib/paraglide/messages.js";
import { auth } from "#lib/stores/auth.svelte.ts";
import { cn } from "#lib/utils.ts";
import { goto } from "$app/navigation";
import { page } from "$app/state";
import Logo from "./logo.svelte";
import UserAvatar from "./user-avatar.svelte";

// Everything account- and admin-related lives in the account menu.
const inLibrary = $derived(
  !page.url.pathname.startsWith("/admin") && !page.url.pathname.startsWith("/profile"),
);

const themes = [
  { value: "light", label: m.theme_light(), icon: Sun },
  { value: "dark", label: m.theme_dark(), icon: Moon },
  { value: "system", label: m.theme_system(), icon: SunMoon },
] as const;

async function signOut() {
  await auth.signOut();
  await goto("/login", { refreshAll: true });
}
</script>

{#snippet themeItems()}
  {#each themes as t (t.value)}
    <DropdownMenu.Item onclick={() => setMode(t.value)}><t.icon /> {t.label}</DropdownMenu.Item>
  {/each}
{/snippet}

{#snippet accountItems(
  itemClass = "",
)}
  <DropdownMenu.Label class="flex items-center gap-3 tracking-normal normal-case">
    <UserAvatar name={auth.user?.name ?? ""} image={auth.user?.image} class="size-9 text-sm" />
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
    {#snippet child({
      props,
    })}
      <a href="/profile" {...props}><UserIcon /> {m.nav_profile()}</a>
    {/snippet}
  </DropdownMenu.Item>
  {#if auth.isAdmin}
    <DropdownMenu.Item class={itemClass}>
      {#snippet child({
        props,
      })}
        <a href="/admin" {...props}><Settings /> {m.nav_admin_settings()}</a>
      {/snippet}
    </DropdownMenu.Item>
  {/if}
{/snippet}

<header class="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
  <div class="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
    <a href="/" aria-label={m.nav_library()} class="shrink-0"><Logo /></a>

    <!-- Desktop: library link, theme and account menus. -->
    <nav class="hidden items-center gap-1 sm:flex">
      <a
        href="/"
        class={cn(
          "px-3 py-2 text-xs font-semibold tracking-widest uppercase transition-colors",
          inLibrary ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {m.nav_library()}
      </a>
    </nav>
    <div class="ml-auto hidden items-center gap-1 sm:flex">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({
            props,
          })}
            <Button {...props} variant="ghost" size="icon-sm" aria-label={m.theme()}>
              {#if mode.current === "dark"}
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
          {#snippet child({
            props,
          })}
            <button {...props} type="button" class="ml-1 rounded-full" aria-label={m.nav_account()}>
              <UserAvatar name={auth.user?.name ?? ""} image={auth.user?.image} />
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="min-w-60">
          {@render accountItems()}
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={signOut}><LogOut /> {m.nav_sign_out()}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>

    <!-- Mobile: everything behind one hamburger menu. -->
    <div class="ml-auto sm:hidden">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({
            props,
          })}
            <Button {...props} variant="ghost" size="icon" aria-label={m.nav_menu()}>
              <Menu class="size-5" />
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-64">
          <DropdownMenu.Item
            class={cn("py-2.5 text-base", inLibrary && "font-semibold text-primary")}
          >
            {#snippet child({
              props,
            })}
              <a href="/" {...props}>{m.nav_library()}</a>
            {/snippet}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          {@render accountItems("py-2.5 text-base")}
          <DropdownMenu.Separator />
          <DropdownMenu.Label class="text-xs font-normal text-muted-foreground"
            >{m.theme()}</DropdownMenu.Label
          >
          {@render themeItems()}
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={signOut} class="py-2.5"
            ><LogOut />
            {m.nav_sign_out()}</DropdownMenu.Item
          >
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>
</header>
