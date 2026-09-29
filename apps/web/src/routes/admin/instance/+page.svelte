<script lang="ts">
import BookPlus from "@lucide/svelte/icons/book-plus";
import HardDrive from "@lucide/svelte/icons/hard-drive";
import Link from "@lucide/svelte/icons/link";
import Pause from "@lucide/svelte/icons/pause";
import Pencil from "@lucide/svelte/icons/pencil";
import Play from "@lucide/svelte/icons/play";
import Trash from "@lucide/svelte/icons/trash-2";
import type { CreatedInvite, TenantOverview } from "@sammelband/shared";
import { invalidate } from "$app/navigation";
import { del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import ActionMenu from "$lib/components/app/action-menu.svelte";
import ExpandableCard from "$lib/components/app/expandable-card.svelte";
import type { RowAction } from "$lib/components/app/row-actions";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import InviteLinkDialog from "$lib/components/dialogs/invite-link-dialog.svelte";
import PromptDialog from "$lib/components/dialogs/prompt-dialog.svelte";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import * as Dialog from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Switch } from "$lib/components/ui/switch";
import * as Table from "$lib/components/ui/table";
import { formatDate } from "$lib/i18n";
import { formatBytes } from "$lib/images";
import { m } from "$lib/paraglide/messages.js";
import { browserTimeZone } from "$lib/timezone";
import { cn } from "$lib/utils";

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

// Two-factor authentication for everyone on the instance. The server refuses
// to turn it on while the owner doesn't use it; the switch then flips back.
// Follows the page data after a reload; the switch overrides it until then.
let twoFactorRequired = $derived(data.overview.two_factor_required);
let savingTwoFactor = $state(false);
async function saveTwoFactor(required: boolean) {
  savingTwoFactor = true;
  const ok = await attempt(
    () => patch("/instance/settings", { twoFactorRequired: required }),
    required ? m.general_two_factor_on() : m.general_two_factor_off(),
  );
  if (ok) await refresh();
  else twoFactorRequired = !required;
  savingTwoFactor = false;
}

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
const confirmMatches = $derived(
  confirmName.trim().toLowerCase() === (target?.name ?? "").toLowerCase(),
);

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
    await attempt(() => Promise.reject(new Error(m.instance_quota_invalid())));
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
    suspended
      ? m.instance_suspended_done({ name: t.name })
      : m.instance_resumed_done({ name: t.name }),
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
    m.instance_deleted({ name: t.name }),
  );
  if (!ok) return;
  deleteOpen = false;
  await refresh();
}

function actionsFor(t: TenantOverview): RowAction[] {
  const actions: RowAction[] = [
    { label: m.common_rename(), icon: Pencil, run: () => open(t, "rename") },
    { label: m.instance_storage_limit(), icon: HardDrive, run: () => open(t, "quota") },
  ];
  // Your own Sammelband can't be suspended or deleted and has its admin already.
  if (t.own) return actions;
  return [
    ...actions,
    { label: m.instance_new_invite(), icon: Link, run: () => renewInvite(t) },
    t.suspended_at
      ? { label: m.instance_resume(), icon: Play, run: () => setSuspended(t, false), group: true }
      : { label: m.instance_suspend(), icon: Pause, run: () => open(t, "suspend"), group: true },
    { label: m.common_delete(), icon: Trash, run: () => open(t, "delete"), destructive: true },
  ];
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

<svelte:head><title>{m.admin_tab_instance()} · Sammelband</title></svelte:head>

<div class="mb-8 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="font-heading text-4xl">{m.admin_tab_instance()}</h1>
    <p class="mt-2 text-muted-foreground">
      {m.instance_description()}
    </p>
  </div>
  <Button onclick={() => (createOpen = true)}><BookPlus /> {m.instance_new()}</Button>
</div>

<div class="mb-8 grid gap-4 sm:grid-cols-3">
  <Card.Root>
    <Card.Header>
      <Card.Description>{m.admin_tab_instance()}</Card.Description>
      <Card.Title class="text-3xl">{tenants.length}</Card.Title>
    </Card.Header>
  </Card.Root>
  <Card.Root>
    <Card.Header>
      <Card.Description>{m.instance_photos_total()}</Card.Description>
      <Card.Title class="text-3xl">{formatBytes(totalUsed)}</Card.Title>
    </Card.Header>
  </Card.Root>
  <Card.Root>
    <Card.Header>
      <Card.Description>{m.instance_database()}</Card.Description>
      <Card.Title class="text-3xl">{formatBytes(data.overview.database.size_bytes)}</Card.Title>
    </Card.Header>
    <Card.Content class="text-xs text-muted-foreground">
      {data.overview.database.type === 'postgres' ? 'PostgreSQL' : 'SQLite'}
    </Card.Content>
  </Card.Root>
</div>

<Card.Root class="mb-8">
  <Card.Header>
    <Card.Title>{m.two_factor_title()}</Card.Title>
    <Card.Description>{m.instance_two_factor_description()}</Card.Description>
  </Card.Header>
  <Card.Content>
    <div class="flex max-w-md items-center justify-between gap-4">
      <Label for="instance-two-factor">{m.general_two_factor_switch()}</Label>
      <Switch
        id="instance-two-factor"
        bind:checked={twoFactorRequired}
        disabled={savingTwoFactor}
        onCheckedChange={saveTwoFactor}
      />
    </div>
  </Card.Content>
</Card.Root>

{#snippet badges(t: TenantOverview)}
  {#if t.own}
    <Badge variant="secondary">{m.instance_yours()}</Badge>
  {/if}
  {#if t.suspended_at}
    <Badge variant="destructive">{m.instance_suspended()}</Badge>
  {/if}
  {#if t.two_factor_required}
    <Badge variant="outline">{m.users_two_factor_badge()}</Badge>
  {/if}
  {#if t.user_count === 0}
    <Badge variant="outline">
      {t.invite_pending ? m.instance_invite_pending() : m.instance_no_users()}
    </Badge>
  {/if}
{/snippet}

{#snippet storage(t: TenantOverview)}
  <span class="tabular-nums">
    {formatBytes(t.storage_used_bytes)}
    <span class="text-muted-foreground">
      / {t.quota_bytes === null ? m.instance_no_limit() : formatBytes(t.quota_bytes)}
    </span>
  </span>
{/snippet}

<!-- Phones: one expandable card per Sammelband instead of the table. -->
<div class="grid gap-2 sm:hidden">
  {#each tenants as t (t.id)}
    <ExpandableCard actions={actionsFor(t)}>
      {#snippet summary()}
        <p class={cn('font-medium', t.suspended_at && 'opacity-60')}>{t.name}</p>
        <div class="mt-1 flex flex-wrap gap-1">{@render badges(t)}</div>
      {/snippet}
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt class="text-muted-foreground">{m.admin_tab_users()}</dt>
        <dd class="tabular-nums">{t.user_count}</dd>
        <dt class="text-muted-foreground">{m.library_albums()}</dt>
        <dd class="tabular-nums">{t.album_count}</dd>
        <dt class="text-muted-foreground">{m.admin_tab_storage()}</dt>
        <dd>{@render storage(t)}</dd>
        <dt class="text-muted-foreground">{m.common_created()}</dt>
        <dd>{formatDate(t.created_at)}</dd>
      </dl>
    </ExpandableCard>
  {/each}
</div>

<div class="hidden sm:block">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.common_name()}</Table.Head>
        <Table.Head class="text-right">{m.admin_tab_users()}</Table.Head>
        <Table.Head class="text-right">{m.library_albums()}</Table.Head>
        <Table.Head>{m.admin_tab_storage()}</Table.Head>
        <Table.Head>{m.common_created()}</Table.Head>
        <Table.Head class="w-10"></Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each tenants as t (t.id)}
        <Table.Row class={t.suspended_at ? 'opacity-60' : ''}>
          <Table.Cell class="font-medium">
            {t.name}
            <span class="ml-2 inline-flex gap-2 align-middle">{@render badges(t)}</span>
          </Table.Cell>
          <Table.Cell class="text-right tabular-nums">{t.user_count}</Table.Cell>
          <Table.Cell class="text-right tabular-nums">{t.album_count}</Table.Cell>
          <Table.Cell>{@render storage(t)}</Table.Cell>
          <Table.Cell class="text-muted-foreground">
            {formatDate(t.created_at)}
          </Table.Cell>
          <Table.Cell>
            <ActionMenu actions={actionsFor(t)} label={m.instance_actions()} />
          </Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
</div>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-4" onsubmit={create}>
      <Dialog.Header>
        <Dialog.Title>{m.instance_new()}</Dialog.Title>
        <Dialog.Description>{m.instance_new_description()}</Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="new-name">{m.common_name()}</Label>
        <Input id="new-name" bind:value={form.name} required maxlength={100} />
      </div>
      <div class="grid gap-2">
        <Label for="new-quota">{m.instance_quota_label()}</Label>
        <Input
          id="new-quota"
          type="number"
          min="0.1"
          step="0.1"
          bind:value={form.quotaGb}
          placeholder={m.storage_no_limit()}
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (createOpen = false)}>{m.common_cancel()}</Button>
        <Button type="submit" disabled={creating}>{m.common_create()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<InviteLinkDialog
  bind:open={inviteOpen}
  {invite}
  title={m.instance_invite_title({ name: inviteFor })}
  description={m.instance_invite_description()}
/>

<PromptDialog
  bind:open={renameOpen}
  title={m.users_rename_title({ email: target?.name ?? '' })}
  label={m.common_name()}
  value={target?.name ?? ''}
  onsubmit={rename}
/>

<Dialog.Root bind:open={quotaOpen}>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-4" onsubmit={saveQuota}>
      <Dialog.Header>
        <Dialog.Title>{m.instance_quota_title({ name: target?.name ?? '' })}</Dialog.Title>
        <Dialog.Description>{m.instance_quota_description()}</Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="quota">{m.instance_quota_label()}</Label>
        <Input
          id="quota"
          type="number"
          min="0.1"
          step="0.1"
          bind:value={quotaGb}
          placeholder={m.storage_no_limit()}
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (quotaOpen = false)}>{m.common_cancel()}</Button>
        <Button type="submit">{m.common_save()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={suspendOpen}
  title={m.instance_suspend_confirm({ name: target?.name ?? '' })}
  description={m.instance_suspend_description()}
  confirmLabel={m.instance_suspend()}
  onconfirm={() => target && setSuspended(target, true)}
/>

<Dialog.Root bind:open={deleteOpen}>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-4" onsubmit={remove}>
      <Dialog.Header>
        <Dialog.Title>{m.folder_delete_confirm({ name: target?.name ?? '' })}</Dialog.Title>
        <Dialog.Description>
          {m.instance_delete_description({
            users: target?.user_count ?? 0,
            albums: target?.album_count ?? 0,
          })}
        </Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="confirm-name">
          <span
            >{m.instance_delete_type_before()}
            <strong class="normal-case tracking-normal">{target?.name}</strong>
            {m.instance_delete_type_after()}</span
          >
        </Label>
        <Input id="confirm-name" bind:value={confirmName} autocomplete="off" />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (deleteOpen = false)}>{m.common_cancel()}</Button>
        <Button type="submit" variant="destructive" disabled={!confirmMatches}
          >{m.common_delete()}</Button
        >
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
