<script lang="ts">
import type { SourceInfo } from "@sammelband/shared";
import { onDestroy, onMount } from "svelte";
import { toast } from "svelte-sonner";
import { api, del, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import SourceIcon from "$lib/components/app/source-icon.svelte";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { errorText } from "$lib/i18n";
import { m } from "$lib/paraglide/messages.js";
import { sources } from "$lib/stores/sources.svelte";

/**
 * The user's accounts at the photo sources of their Sammelband (profile page).
 * Nextcloud: "Connect" opens Nextcloud in a new tab to allow access (Login
 * Flow v2); this page polls until that's done. An app password works too.
 */
onMount(() => void sources.load(true));

const POLL_MS = 2000;
let waiting = $state<string | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
let manual = $state<string | null>(null);
let loginName = $state("");
let appPassword = $state("");
let saving = $state(false);

function stopWaiting() {
  clearInterval(timer);
  timer = undefined;
  waiting = null;
}
onDestroy(stopWaiting);

async function connected(s: SourceInfo) {
  stopWaiting();
  manual = null;
  await sources.load(true);
  toast.success(m.sources_connected({ source: s.name }));
}

async function connect(s: SourceInfo) {
  // Opened right away (still inside the click), so popup blockers let it through.
  const tab = window.open("about:blank", "_blank");
  try {
    const { login } = await post<{ login: string }>(`/sources/${s.id}/connect`);
    if (tab) {
      tab.opener = null; // Nextcloud's page gets no handle on this one
      tab.location.href = login;
    } else window.location.href = login;
  } catch (err) {
    tab?.close();
    toast.error(errorText(err));
    return;
  }
  waiting = s.id;
  clearInterval(timer);
  timer = setInterval(async () => {
    try {
      const res = await post<{ connected: boolean }>(`/sources/${s.id}/connect/poll`);
      if (res.connected) await connected(s);
    } catch (err) {
      stopWaiting();
      toast.error(errorText(err));
    }
  }, POLL_MS);
}

async function saveAppPassword(e: SubmitEvent, s: SourceInfo) {
  e.preventDefault();
  saving = true;
  const ok = await attempt(() =>
    api(`/sources/${s.id}/account`, { method: "PUT", body: { loginName, appPassword } }),
  );
  saving = false;
  if (!ok) return;
  loginName = "";
  appPassword = "";
  await connected(s);
}

async function disconnect(s: SourceInfo) {
  if (
    await attempt(() => del(`/sources/${s.id}/account`), m.sources_disconnected({ source: s.name }))
  ) {
    await sources.load(true);
  }
}
</script>

{#if sources.list.length > 0}
  <Card.Root id="sources">
    <Card.Header>
      <Card.Title>{m.sources_title()}</Card.Title>
      <Card.Description>{m.sources_description()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-6">
      {#each sources.list as s (s.id)}
        <div class="grid gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <SourceIcon id={s.id} class="size-5 text-muted-foreground" />
            <div class="min-w-0 flex-1">
              <p class="font-medium">{s.name}</p>
              <p class="text-sm text-muted-foreground">
                {s.account ? m.sources_connected_as({ name: s.account.label }) : m.sources_not_connected()}
              </p>
            </div>
            {#if s.account}
              <Button variant="outline" onclick={() => disconnect(s)}
                >{m.sources_disconnect()}</Button
              >
            {:else if waiting === s.id}
              <Button variant="ghost" onclick={stopWaiting}>{m.common_cancel()}</Button>
            {:else}
              <Button onclick={() => connect(s)}>{m.sources_connect()}</Button>
            {/if}
          </div>
          {#if waiting === s.id}
            <p class="text-sm text-muted-foreground">{m.sources_waiting({ source: s.name })}</p>
          {/if}
          {#if !s.account && waiting !== s.id}
            {#if manual === s.id}
              <form
                class="grid gap-3 rounded-lg border p-4"
                onsubmit={(e) => saveAppPassword(e, s)}
              >
                <p class="text-sm text-muted-foreground">{m.sources_app_password_hint()}</p>
                <div class="grid gap-2">
                  <Label for="source-login">{m.sources_login_name()}</Label>
                  <Input
                    id="source-login"
                    bind:value={loginName}
                    required
                    autocomplete="username"
                  />
                </div>
                <div class="grid gap-2">
                  <Label for="source-password">{m.sources_app_password()}</Label>
                  <Input
                    id="source-password"
                    type="password"
                    bind:value={appPassword}
                    required
                    autocomplete="off"
                  />
                </div>
                <div class="flex gap-2">
                  <Button type="submit" disabled={saving}>{m.sources_connect()}</Button>
                  <Button variant="ghost" onclick={() => (manual = null)}
                    >{m.common_cancel()}</Button
                  >
                </div>
              </form>
            {:else}
              <Button
                variant="link"
                class="h-auto justify-start p-0 text-muted-foreground"
                onclick={() => (manual = s.id)}
              >
                {m.sources_app_password_toggle()}
              </Button>
            {/if}
          {/if}
        </div>
      {/each}
    </Card.Content>
  </Card.Root>
{/if}
