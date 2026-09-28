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
import { m } from "$lib/paraglide/messages.js";
import { auth } from "$lib/stores/auth.svelte";
import { endOfDayIn, formatInZone } from "$lib/timezone";
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

// Expiry dates refer to the Sammelband's time zone (Admin settings → General).
const zone = $derived(auth.tenant?.timezone ?? "UTC");
const today = new Date().toISOString().slice(0, 10);
const expiryPreview = $derived(expires ? formatInZone(endOfDayIn(expires, zone), zone) : null);

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
  // The server ends the link at 23:59:59 of that day in the Sammelband's zone.
  const created = await attempt(() =>
    post<ShareLinkInfo>("/shares", {
      ...target,
      password: withPassword ? password : null,
      expiresOn: withExpiry && expires ? expires : null,
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
  if (await attempt(() => del(`/shares/${link.id}`), m.share_revoked())) await onchange();
}
</script>

<Dialog.Root bind:open onOpenChange={(o) => !o && resetForm()}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.share_title({ name })}</Dialog.Title>
      <Dialog.Description>
        {isFolder ? m.share_description_folder() : m.share_description_album()}
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
                aria-label={m.common_copy_link()}
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
                aria-label={m.share_revoke()}
              >
                <Trash />
              </Button>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {#if expired}
                <Badge variant="destructive">{m.share_expired()}</Badge>
              {/if}
              {#if link.has_password}
                <Badge variant="secondary"><KeyRound /> {m.common_password()}</Badge>
              {/if}
              <span>
                {#if link.expires_at}
                  {expired
                    ? m.share_expired_at({ time: formatInZone(link.expires_at, zone) })
                    : m.share_expires_at({ time: formatInZone(link.expires_at, zone) })}
                {:else}
                  {m.share_no_expiry()}
                {/if}
              </span>
              <span>· {m.share_by({ name: link.created_by_name ?? m.share_former_user() })}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if creating}
      <form class="grid gap-4 rounded-lg border p-4" onsubmit={create}>
        <div class="grid gap-3">
          <div class="flex items-center justify-between gap-4">
            <Label for="share-with-password">{m.common_password()}</Label>
            <Switch id="share-with-password" bind:checked={withPassword} />
          </div>
          {#if withPassword}
            <Input
              type="text"
              bind:value={password}
              placeholder={m.share_password_placeholder()}
              aria-label={m.common_password()}
              autocomplete="off"
              required
              minlength={4}
              maxlength={128}
            />
          {/if}
        </div>
        <div class="grid gap-3">
          <div class="flex items-center justify-between gap-4">
            <Label for="share-with-expiry">{m.share_expiry_date()}</Label>
            <Switch id="share-with-expiry" bind:checked={withExpiry} />
          </div>
          {#if withExpiry}
            <Input
              type="date"
              bind:value={expires}
              min={today}
              aria-label={m.share_expiry_date()}
              required
            />
            <p class="text-xs text-muted-foreground">
              {expiryPreview
                ? m.share_expiry_preview({ time: expiryPreview, zone })
                : m.share_expiry_hint({ zone })}
            </p>
          {/if}
        </div>
        <div class="flex justify-end gap-2">
          {#if links.length > 0}
            <Button variant="outline" onclick={resetForm}>{m.common_cancel()}</Button>
          {/if}
          <Button type="submit" disabled={busy}>{m.share_create()}</Button>
        </div>
      </form>
    {:else}
      <Button variant="outline" class="w-full" onclick={() => (creating = true)}>
        <Plus />
        {m.share_new()}
      </Button>
    {/if}
  </Dialog.Content>
</Dialog.Root>
