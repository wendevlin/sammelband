<script lang="ts">
import FolderOpen from "@lucide/svelte/icons/folder-open";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import type { SourceAccount, SourceInfo } from "@sammelband/shared";
import { onDestroy, onMount } from "svelte";
import { toast } from "svelte-sonner";
import { del, patch, post } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import SourceFolderDialog from "#lib/components/app/source-folder-dialog.svelte";
import SourceIcon from "#lib/components/app/source-icon.svelte";
import PromptDialog from "#lib/components/dialogs/prompt-dialog.svelte";
import { Button } from "#lib/components/ui/button/index.ts";
import * as Card from "#lib/components/ui/card/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import { errorText } from "#lib/i18n.ts";
import { m } from "#lib/paraglide/messages.js";
import { accountTitle, serverHost } from "#lib/sources.ts";
import { sources } from "#lib/stores/sources.svelte.ts";

/**
 * The user's accounts at the photo sources of their Sammelband (profile page):
 * several per source, on the admins' default server or another one, each with
 * an optional name. Nextcloud: "Sign in" opens Nextcloud in a new tab to allow
 * access (Login Flow v2); this page polls until that's done. An app password
 * works too. Each account can have a start folder, where the picker opens.
 */
onMount(() => void sources.load(true));

const POLL_MS = 2000;

// The "add an account" form, open for one source at a time.
let adding = $state<string | null>(null);
let server = $state("");
let name = $state("");
let manual = $state(false);
let loginName = $state("");
let appPassword = $state("");
let busy = $state(false);
let waiting = $state(false);
let timer: ReturnType<typeof setInterval> | undefined;

let renaming = $state<SourceAccount | null>(null);
let renameOpen = $state(false);
let startFolder = $state<{ account: SourceAccount; title: string } | null>(null);
let startFolderOpen = $state(false);

function stopWaiting() {
  clearInterval(timer);
  timer = undefined;
  waiting = false;
}
onDestroy(stopWaiting);

function startAdding(s: SourceInfo) {
  stopWaiting();
  adding = s.id;
  server = s.default_server ?? "";
  name = "";
  manual = false;
  loginName = "";
  appPassword = "";
}

function closeForm() {
  stopWaiting();
  adding = null;
}

/** What the server needs to know: the address only when it isn't the default. */
function target(s: SourceInfo) {
  const url = server.trim();
  return {
    url: url && url !== s.default_server ? url : undefined,
    name: name.trim() || null,
  };
}

async function added(s: SourceInfo) {
  closeForm();
  await sources.load(true);
  toast.success(m.sources_connected({ source: s.name }));
}

async function signIn(s: SourceInfo) {
  // Opened right away (still inside the click), so popup blockers let it through.
  const tab = window.open("about:blank", "_blank");
  busy = true;
  let flow: string;
  try {
    const res = await post<{ login: string; flow: string }>(`/sources/${s.id}/connect`, target(s));
    flow = res.flow;
    if (tab) {
      tab.opener = null; // Nextcloud's page gets no handle on this one
      tab.location.href = res.login;
    } else window.open(res.login, "_blank", "noopener");
  } catch (err) {
    tab?.close();
    toast.error(errorText(err));
    return;
  } finally {
    busy = false;
  }
  waiting = true;
  clearInterval(timer);
  timer = setInterval(async () => {
    try {
      const res = await post<{ connected: boolean }>(`/sources/${s.id}/connect/poll`, { flow });
      if (res.connected) await added(s);
    } catch (err) {
      stopWaiting();
      toast.error(errorText(err));
    }
  }, POLL_MS);
}

async function saveAppPassword(e: SubmitEvent, s: SourceInfo) {
  e.preventDefault();
  busy = true;
  const ok = await attempt(() =>
    post(`/sources/${s.id}/accounts`, { ...target(s), loginName, appPassword }),
  );
  busy = false;
  if (ok) await added(s);
}

function startRename(account: SourceAccount) {
  renaming = account;
  renameOpen = true;
}

async function rename(value: string): Promise<boolean | undefined> {
  const account = renaming;
  if (!account) return;
  const ok = await attempt(() => patch(`/sources/accounts/${account.id}`, { name: value }));
  if (!ok) return false;
  await sources.load(true);
}

function chooseStartFolder(s: SourceInfo, account: SourceAccount) {
  startFolder = { account, title: accountTitle(s, account) };
  startFolderOpen = true;
}

async function saveStartFolder(location: string): Promise<boolean> {
  const account = startFolder?.account;
  if (!account) return false;
  const ok = await attempt(
    () => patch(`/sources/accounts/${account.id}`, { start_location: location }),
    m.sources_start_folder_saved(),
  );
  if (ok === undefined) return false;
  await sources.load(true);
  return true;
}

async function disconnect(s: SourceInfo, account: SourceAccount) {
  const ok = await attempt(
    () => del(`/sources/accounts/${account.id}`),
    m.sources_disconnected({ source: accountTitle(s, account) }),
  );
  if (ok) await sources.load(true);
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
          {#each s.accounts as a (a.id)}
            <div class="flex flex-wrap items-center gap-3">
              <SourceIcon id={s.id} class="size-5 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium">{accountTitle(s, a)}</p>
                <p class="truncate text-sm text-muted-foreground">
                  {m.sources_account_at({ name: a.label, server: serverHost(a.server) })}
                </p>
                {#if a.start_location}
                  <p class="truncate text-sm text-muted-foreground">
                    {m.sources_start_folder_value({ folder: a.start_location })}
                  </p>
                {/if}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={m.sources_start_folder()}
                title={m.sources_start_folder()}
                onclick={() => chooseStartFolder(s, a)}
              >
                <FolderOpen />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={m.sources_rename()}
                title={m.sources_rename()}
                onclick={() => startRename(a)}
              >
                <Pencil />
              </Button>
              <Button variant="outline" onclick={() => disconnect(s, a)}
                >{m.sources_disconnect()}</Button
              >
            </div>
          {/each}

          {#if adding === s.id}
            {@render addForm(s)}
          {:else}
            <div>
              <Button
                variant={s.accounts.length === 0 ? "default" : "outline"}
                onclick={() => startAdding(s)}
              >
                {#if s.accounts.length === 0}
                  <SourceIcon id={s.id} />
                  {m.sources_connect_source({ source: s.name })}
                {:else}
                  <Plus />
                  {m.sources_add({ source: s.name })}
                {/if}
              </Button>
            </div>
          {/if}
        </div>
      {/each}
    </Card.Content>
  </Card.Root>
{/if}

<PromptDialog
  bind:open={renameOpen}
  title={m.sources_rename()}
  label={m.sources_name()}
  value={renaming?.name ?? ""}
  onsubmit={rename}
/>

{#if startFolder}
  <SourceFolderDialog
    bind:open={startFolderOpen}
    account={startFolder.account}
    title={startFolder.title}
    onchoose={saveStartFolder}
  />
{/if}

{#snippet addForm(
  s: SourceInfo,
)}
  <form class="grid gap-4 rounded-lg border p-4" onsubmit={(e) => saveAppPassword(e, s)}>
    <div class="grid gap-2">
      <Label for="source-server-{s.id}">{m.sources_server()}</Label>
      <Input
        id="source-server-{s.id}"
        type="url"
        placeholder="https://cloud.example.com"
        required={!s.default_server}
        disabled={waiting}
        bind:value={server}
      />
      {#if s.default_server}
        <p class="text-sm text-muted-foreground">{m.sources_server_default()}</p>
      {/if}
    </div>
    <div class="grid gap-2">
      <Label for="source-name-{s.id}">{m.sources_name()}</Label>
      <Input
        id="source-name-{s.id}"
        placeholder={m.sources_name_placeholder()}
        maxlength={100}
        disabled={waiting}
        bind:value={name}
      />
    </div>

    {#if waiting}
      <p class="text-sm text-muted-foreground">{m.sources_waiting({ source: s.name })}</p>
      <div>
        <Button variant="ghost" onclick={stopWaiting}>{m.common_cancel()}</Button>
      </div>
    {:else if manual}
      <p class="text-sm text-muted-foreground">{m.sources_app_password_hint()}</p>
      <div class="grid gap-2">
        <Label for="source-login-{s.id}">{m.sources_login_name()}</Label>
        <Input id="source-login-{s.id}" bind:value={loginName} required autocomplete="username" />
      </div>
      <div class="grid gap-2">
        <Label for="source-password-{s.id}">{m.sources_app_password()}</Label>
        <Input
          id="source-password-{s.id}"
          type="password"
          bind:value={appPassword}
          required
          autocomplete="off"
        />
      </div>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{m.sources_connect()}</Button>
        <Button variant="ghost" onclick={() => (manual = false)}
          >{m.sources_sign_in_instead()}</Button
        >
      </div>
    {:else}
      <div class="flex flex-wrap items-center gap-2">
        <Button disabled={busy || (!s.default_server && !server.trim())} onclick={() => signIn(s)}>
          {m.sources_sign_in({ source: s.name })}
        </Button>
        <Button variant="ghost" onclick={closeForm}>{m.common_cancel()}</Button>
      </div>
      <Button
        variant="link"
        class="h-auto justify-start p-0 text-muted-foreground"
        onclick={() => (manual = true)}
      >
        {m.sources_app_password_toggle()}
      </Button>
    {/if}
  </form>
{/snippet}
