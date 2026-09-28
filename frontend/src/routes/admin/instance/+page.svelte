<script lang="ts">
import BookPlus from "@lucide/svelte/icons/book-plus";
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import Link from "@lucide/svelte/icons/link";
import Pause from "@lucide/svelte/icons/pause";
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import Trash from "@lucide/svelte/icons/trash-2";
import { invalidate } from "$app/navigation";
import { del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import InviteLinkDialog from "$lib/components/dialogs/invite-link-dialog.svelte";
import PromptDialog from "$lib/components/dialogs/prompt-dialog.svelte";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import * as Dialog from "$lib/components/ui/dialog";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import * as Table from "$lib/components/ui/table";
import { formatBytes } from "$lib/images";
import { browserTimeZone } from "$lib/timezone";
import type { CreatedInvite, TenantOverview } from "$lib/types";

let { data } = $props();

const GB = 1024 ** 3;
const refresh = () => invalidate("app:instance");
const tenants = $derived(data.overview.tenants);
const totalUsed = $derived(tenants.reduce((sum, t) => sum + t.storage_used_bytes, 0));

/** Number inputs bind numbers, or null/"" when empty (= no limit). */
type GbInput = number | string | null;
const toBytes = (gb: GbInput) =>
  gb === null || String(gb).trim() === "" ? null : Math.round(Number(gb) * GB);
const toGb = (bytes: number | null): GbInput => (bytes === null ? null : +(bytes / GB).toFixed(2));

// Invite link shown after creating a Sammelband or renewing its admin invite.
let invite = $state<CreatedInvite | null>(null);
let inviteOpen = $state(false);
let inviteFor = $state("");
function showInvite(created: CreatedInvite, name: string) {
  invite = created;
  inviteFor = name;
  inviteOpen = true;
}

// Create
let createOpen = $state(false);
let form = $state<{ name: string; quotaGb: GbInput }>({ name: "", quotaGb: null });
let creating = $state(false);

async function create(e: SubmitEvent) {
  e.preventDefault();
  creating = true;
  const created = await attempt(() =>
    post<{ invite: CreatedInvite }>("/instance/tenants", {
      name: form.name,
      quotaBytes: toBytes(form.quotaGb),
      timezone: browserTimeZone(),
    }),
  );
  creating = false;
  if (!created) return;
  createOpen = false;
  showInvite(created.invite, form.name);
  form = { name: "", quotaGb: null };
  await refresh();
}

// Row actions
let target = $state<TenantOverview | null>(null);
let renameOpen = $state(false);
let quotaOpen = $state(false);
let quotaGb = $state<GbInput>(null);
let suspendOpen = $state(false);
let deleteOpen = $state(false);
let confirmName = $state("");

async function rename(name: string) {
  if (!target) return false;
  const ok = await attempt(() => patch(`/instance/tenants/${target?.id}`, { name }));
  if (ok) await refresh();
  return Boolean(ok);
}

async function saveQuota(e: SubmitEvent) {
  e.preventDefault();
  if (!target) return;
  const quotaBytes = toBytes(quotaGb);
  if (quotaBytes !== null && !(quotaBytes > 0)) {
    await attempt(() => Promise.reject(new Error("Enter a positive number of GB, or leave empty")));
    return;
  }
  if (await attempt(() => patch(`/instance/tenants/${target?.id}`, { quotaBytes }))) {
    quotaOpen = false;
    await refresh();
  }
}

async function setSuspended(t: TenantOverview, suspended: boolean) {
  const ok = await attempt(
    () => patch(`/instance/tenants/${t.id}`, { suspended }),
    suspended ? `${t.name} is suspended` : `${t.name} is active again`,
  );
  if (ok) await refresh();
}

async function renewInvite(t: TenantOverview) {
  const created = await attempt(() => post<CreatedInvite>(`/instance/tenants/${t.id}/invite`));
  if (created) {
    showInvite(created, t.name);
    await refresh();
  }
}

async function remove(e: SubmitEvent) {
  e.preventDefault();
  const t = target;
  if (!t) return;
  const ok = await attempt(
    () => del(`/instance/tenants/${t.id}`, { confirmName }),
    `Deleted ${t.name}`,
  );
  if (!ok) return;
  deleteOpen = false;
  await refresh();
}

function open(t: TenantOverview, what: "rename" | "quota" | "suspend" | "delete") {
  target = t;
  if (what === "rename") renameOpen = true;
  if (what === "quota") {
    quotaGb = toGb(t.quota_bytes);
    quotaOpen = true;
  }
  if (what === "suspend") suspendOpen = true;
  if (what === "delete") {
    confirmName = "";
    deleteOpen = true;
  }
}
</script>

<svelte:head><title>Sammelbände · Sammelband</title></svelte:head>

<div class="mb-8 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="font-heading text-4xl">Sammelbände</h1>
    <p class="mt-2 text-muted-foreground">
      Each Sammelband has its own users, albums and photos. You see names and numbers here, never
      their content.
    </p>
  </div>
  <Button onclick={() => (createOpen = true)}><BookPlus /> New Sammelband</Button>
</div>

<div class="mb-8 grid gap-4 sm:grid-cols-3">
  <Card.Root>
    <Card.Header>
      <Card.Description>Sammelbände</Card.Description>
      <Card.Title class="text-3xl">{tenants.length}</Card.Title>
    </Card.Header>
  </Card.Root>
  <Card.Root>
    <Card.Header>
      <Card.Description>Photos, all Sammelbände</Card.Description>
      <Card.Title class="text-3xl">{formatBytes(totalUsed)}</Card.Title>
    </Card.Header>
  </Card.Root>
  <Card.Root>
    <Card.Header>
      <Card.Description>Database</Card.Description>
      <Card.Title class="text-3xl">{formatBytes(data.overview.database.size_bytes)}</Card.Title>
    </Card.Header>
    <Card.Content class="text-xs text-muted-foreground">
      {data.overview.database.type === 'postgres' ? 'PostgreSQL' : 'SQLite'}
    </Card.Content>
  </Card.Root>
</div>

<Table.Root>
  <Table.Header>
    <Table.Row>
      <Table.Head>Name</Table.Head>
      <Table.Head class="text-right">Users</Table.Head>
      <Table.Head class="text-right">Albums</Table.Head>
      <Table.Head>Storage</Table.Head>
      <Table.Head>Created</Table.Head>
      <Table.Head class="w-10"></Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each tenants as t (t.id)}
      <Table.Row class={t.suspended_at ? 'opacity-60' : ''}>
        <Table.Cell class="font-medium">
          {t.name}
          {#if t.own}
            <Badge variant="secondary" class="ml-2">Yours</Badge>
          {/if}
          {#if t.suspended_at}
            <Badge variant="destructive" class="ml-2">Suspended</Badge>
          {/if}
          {#if t.user_count === 0}
            <Badge variant="outline" class="ml-2">
              {t.invite_pending ? 'Invite pending' : 'No users'}
            </Badge>
          {/if}
        </Table.Cell>
        <Table.Cell class="text-right tabular-nums">{t.user_count}</Table.Cell>
        <Table.Cell class="text-right tabular-nums">{t.album_count}</Table.Cell>
        <Table.Cell class="tabular-nums">
          {formatBytes(t.storage_used_bytes)}
          <span class="text-muted-foreground">
            / {t.quota_bytes === null ? 'no limit' : formatBytes(t.quota_bytes)}
          </span>
        </Table.Cell>
        <Table.Cell class="text-muted-foreground">
          {new Date(t.created_at).toLocaleDateString()}
        </Table.Cell>
        <Table.Cell>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon-sm" aria-label="Sammelband actions">
                  <EllipsisVertical />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onclick={() => open(t, 'rename')}
                ><Pencil />
                Rename</DropdownMenu.Item
              >
              <DropdownMenu.Item onclick={() => open(t, 'quota')}>
                <HardDrive />
                Storage limit
              </DropdownMenu.Item>
              {#if !t.own}
                <DropdownMenu.Item onclick={() => renewInvite(t)}>
                  <Link />
                  New admin invite link
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                {#if t.suspended_at}
                  <DropdownMenu.Item onclick={() => setSuspended(t, false)}>
                    <Play />
                    Resume
                  </DropdownMenu.Item>
                {:else}
                  <DropdownMenu.Item onclick={() => open(t, 'suspend')}>
                    <Pause />
                    Suspend
                  </DropdownMenu.Item>
                {/if}
                <DropdownMenu.Item variant="destructive" onclick={() => open(t, 'delete')}>
                  <Trash />
                  Delete
                </DropdownMenu.Item>
              {/if}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-4" onsubmit={create}>
      <Dialog.Header>
        <Dialog.Title>New Sammelband</Dialog.Title>
        <Dialog.Description>
          You get an invite link for its first admin, who then invites everyone else.
        </Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="new-name">Name</Label>
        <Input id="new-name" bind:value={form.name} required maxlength={100} />
      </div>
      <div class="grid gap-2">
        <Label for="new-quota">Storage limit in GB</Label>
        <Input
          id="new-quota"
          type="number"
          min="0.1"
          step="0.1"
          bind:value={form.quotaGb}
          placeholder="No limit"
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
        <Button type="submit" disabled={creating}>Create</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<InviteLinkDialog
  bind:open={inviteOpen}
  {invite}
  title="Admin invite for {inviteFor}"
  description="Send this link to the person who will run this Sammelband."
/>

<PromptDialog
  bind:open={renameOpen}
  title="Rename {target?.name ?? ''}"
  label="Name"
  value={target?.name ?? ''}
  onsubmit={rename}
/>

<Dialog.Root bind:open={quotaOpen}>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-4" onsubmit={saveQuota}>
      <Dialog.Header>
        <Dialog.Title>Storage limit for {target?.name ?? ''}</Dialog.Title>
        <Dialog.Description>
          Counts original photos. Uploads beyond the limit are refused; nothing is deleted.
        </Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="quota">Limit in GB</Label>
        <Input
          id="quota"
          type="number"
          min="0.1"
          step="0.1"
          bind:value={quotaGb}
          placeholder="No limit"
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (quotaOpen = false)}>Cancel</Button>
        <Button type="submit">Save</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={suspendOpen}
  title="Suspend {target?.name ?? ''}?"
  description="Its users are signed out and can't sign in until you resume it. Nothing is deleted."
  confirmLabel="Suspend"
  onconfirm={() => target && setSuspended(target, true)}
/>

<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-4" onsubmit={remove}>
      <Dialog.Header>
        <Dialog.Title>Delete {target?.name ?? ''}?</Dialog.Title>
        <Dialog.Description>
          This permanently deletes its {target?.user_count ?? 0} user(s), {target?.album_count ?? 0}
          album(s) and all photo files. It can't be undone.
        </Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="confirm-name">Type <strong>{target?.name}</strong> to confirm</Label>
        <Input id="confirm-name" bind:value={confirmName} autocomplete="off" />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (deleteOpen = false)}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={confirmName.trim() !== target?.name}>
          Delete
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
