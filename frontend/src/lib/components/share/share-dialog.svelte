<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import KeyRound from "@lucide/svelte/icons/key-round";
import Trash from "@lucide/svelte/icons/trash-2";
import { api, del, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Separator } from "$lib/components/ui/separator";
import type { ShareLinkInfo } from "$lib/types";

/** Public links of one album or folder: create, copy, revoke. */
let {
  open = $bindable(false),
  target,
  name,
}: {
  open?: boolean;
  target: { albumId: string } | { folderId: string };
  name: string;
} = $props();

const isFolder = $derived("folderId" in target);
const query = $derived(
  "albumId" in target ? `albumId=${target.albumId}` : `folderId=${target.folderId}`,
);

let links = $state<ShareLinkInfo[]>([]);
let password = $state("");
let expires = $state(""); // yyyy-mm-dd, empty = never
let busy = $state(false);
let copied = $state<string | null>(null);

async function refresh() {
  links = (await attempt(() => api<ShareLinkInfo[]>(`/shares?${query}`))) ?? [];
}

$effect(() => {
  if (open) void refresh();
});

const today = new Date().toISOString().slice(0, 10);

async function create(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  // The link works until the end of the chosen day.
  const expiresAt = expires ? new Date(`${expires}T23:59:59`).getTime() : null;
  const created = await attempt(() =>
    post<ShareLinkInfo>("/shares", { ...target, password: password || null, expiresAt }),
  );
  busy = false;
  if (!created) return;
  password = "";
  expires = "";
  await refresh();
  await copy(created);
}

async function copy(link: ShareLinkInfo) {
  await navigator.clipboard.writeText(link.url).catch(() => {});
  copied = link.id;
  setTimeout(() => (copied = null), 2000);
}

async function revoke(link: ShareLinkInfo) {
  if (await attempt(() => del(`/shares/${link.id}`), "Link revoked")) await refresh();
}
</script>

<Dialog.Root bind:open>
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
          <li class="grid gap-2 rounded-lg border p-3">
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
              {#if link.has_password}
                <Badge variant="secondary"><KeyRound /> Password</Badge>
              {/if}
              <span>
                {link.expires_at
                  ? `Expires ${new Date(link.expires_at).toLocaleDateString()}`
                  : 'No expiry'}
              </span>
              <span>· by {link.created_by_name ?? 'a former user'}</span>
            </div>
          </li>
        {/each}
      </ul>
      <Separator />
    {/if}

    <form class="grid gap-4" onsubmit={create}>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-2">
          <Label for="share-password">Password (optional)</Label>
          <Input
            id="share-password"
            type="text"
            bind:value={password}
            autocomplete="off"
            minlength={4}
            maxlength={128}
          />
        </div>
        <div class="grid gap-2">
          <Label for="share-expires">Expires (optional)</Label>
          <Input id="share-expires" type="date" bind:value={expires} min={today} />
        </div>
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (open = false)}>Done</Button>
        <Button type="submit" disabled={busy}>Create link</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
