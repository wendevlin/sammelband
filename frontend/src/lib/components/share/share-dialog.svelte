<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import KeyRound from "@lucide/svelte/icons/key-round";
import Plus from "@lucide/svelte/icons/plus";
import Trash from "@lucide/svelte/icons/trash-2";
import { del, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Switch } from "$lib/components/ui/switch";
import type { ShareLinkInfo } from "$lib/types";
import { isExpired } from "./share-status";

/** Public links of one album or folder: list, copy, revoke, create. */
let {
  open = $bindable(false),
  target,
  name,
  links,
  onchange,
}: {
  open?: boolean;
  target: { albumId: string } | { folderId: string };
  name: string;
  links: ShareLinkInfo[];
  /** Reload `links` after a change. */
  onchange: () => Promise<void>;
} = $props();

const isFolder = $derived("folderId" in target);

// New-link form, collapsed below the list; open right away when there is no link yet.
let creating = $state(false);
let withPassword = $state(false);
let password = $state("");
let withExpiry = $state(false);
let expires = $state(""); // yyyy-mm-dd
let busy = $state(false);
let copied = $state<string | null>(null);

$effect(() => {
  if (open) creating = links.length === 0;
});

const today = new Date().toISOString().slice(0, 10);

function resetForm() {
  creating = false;
  withPassword = false;
  password = "";
  withExpiry = false;
  expires = "";
}

async function create(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  // The link works until the end of the chosen day.
  const expiresAt = withExpiry && expires ? new Date(`${expires}T23:59:59`).getTime() : null;
  const created = await attempt(() =>
    post<ShareLinkInfo>("/shares", {
      ...target,
      password: withPassword ? password : null,
      expiresAt,
    }),
  );
  busy = false;
  if (!created) return;
  resetForm();
  await onchange();
  await copy(created);
}

async function copy(link: ShareLinkInfo) {
  await navigator.clipboard.writeText(link.url).catch(() => {});
  copied = link.id;
  setTimeout(() => (copied = null), 2000);
}

async function revoke(link: ShareLinkInfo) {
  if (await attempt(() => del(`/shares/${link.id}`), "Link revoked")) await onchange();
}
</script>

<Dialog.Root bind:open onOpenChange={(o) => !o && resetForm()}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Share “{name}”</Dialog.Title>
      <Dialog.Description>
        Anyone with a link can view this {isFolder ? 'folder, its sub-folders and albums' : 'album'}
        without an account. Photos are shown in web size, never as originals.
      </Dialog.Description>
    </Dialog.Header>

    {#if links.length > 0}
      <ul class="grid gap-3">
        {#each links as link (link.id)}
          {@const expired = isExpired(link)}
          <li class="grid gap-2 rounded-lg border p-3" class:opacity-60={expired}>
            <div class="flex gap-2">
              <Input
                readonly
                value={link.url}
                class="h-8 font-mono text-xs"
                onfocus={(e) => e.currentTarget.select()}
              />
              <Button
                variant="outline"
                size="icon-sm"
                onclick={() => copy(link)}
                aria-label="Copy link"
              >
                {#if copied === link.id}
                  <Check />
                {:else}
                  <Copy />
                {/if}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onclick={() => revoke(link)}
                aria-label="Revoke link"
              >
                <Trash />
              </Button>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {#if expired}
                <Badge variant="destructive">Expired</Badge>
              {/if}
              {#if link.has_password}
                <Badge variant="secondary"><KeyRound /> Password</Badge>
              {/if}
              <span>
                {#if link.expires_at}
                  {expired ? 'Expired' : 'Expires'} {new Date(link.expires_at).toLocaleDateString()}
                {:else}
                  No expiry
                {/if}
              </span>
              <span>· by {link.created_by_name ?? 'a former user'}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if creating}
      <form class="grid gap-4 rounded-lg border p-4" onsubmit={create}>
        <div class="grid gap-3">
          <div class="flex items-center justify-between gap-4">
            <Label for="share-with-password">Password</Label>
            <Switch id="share-with-password" bind:checked={withPassword} />
          </div>
          {#if withPassword}
            <Input
              type="text"
              bind:value={password}
              placeholder="At least 4 characters"
              aria-label="Password"
              autocomplete="off"
              required
              minlength={4}
              maxlength={128}
            />
          {/if}
        </div>
        <div class="grid gap-3">
          <div class="flex items-center justify-between gap-4">
            <Label for="share-with-expiry">Expiry date</Label>
            <Switch id="share-with-expiry" bind:checked={withExpiry} />
          </div>
          {#if withExpiry}
            <Input type="date" bind:value={expires} min={today} aria-label="Expires on" required />
          {/if}
        </div>
        <div class="flex justify-end gap-2">
          {#if links.length > 0}
            <Button variant="outline" onclick={resetForm}>Cancel</Button>
          {/if}
          <Button type="submit" disabled={busy}>Create link</Button>
        </div>
      </form>
    {:else}
      <Button variant="outline" class="w-full" onclick={() => (creating = true)}>
        <Plus />
        New link
      </Button>
    {/if}
  </Dialog.Content>
</Dialog.Root>
