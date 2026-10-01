<script lang="ts">
import ImageMinus from "@lucide/svelte/icons/image-minus";
import ImageUp from "@lucide/svelte/icons/image-up";
import KeyRound from "@lucide/svelte/icons/key-round";
import Link from "@lucide/svelte/icons/link";
import Pencil from "@lucide/svelte/icons/pencil";
import ShieldOff from "@lucide/svelte/icons/shield-off";
import Trash from "@lucide/svelte/icons/trash-2";
import UserPlus from "@lucide/svelte/icons/user-plus";
import type { CreatedInvite, Role, User } from "@sammelband/shared";
import { invalidate } from "$app/navigation";
import { api, del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import { avatarForm } from "$lib/avatar";
import ActionMenu from "$lib/components/app/action-menu.svelte";
import ExpandableCard from "$lib/components/app/expandable-card.svelte";
import type { RowAction } from "$lib/components/app/row-actions";
import SimpleSelect from "$lib/components/app/simple-select.svelte";
import UserAvatar from "$lib/components/app/user-avatar.svelte";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import InviteLinkDialog from "$lib/components/dialogs/invite-link-dialog.svelte";
import PromptDialog from "$lib/components/dialogs/prompt-dialog.svelte";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import * as Table from "$lib/components/ui/table";
import { formatDate } from "$lib/i18n";
import { m } from "$lib/paraglide/messages.js";
import { auth } from "$lib/stores/auth.svelte";

let { data } = $props();

const ROLES = [
  { value: "user", label: m.role_user() },
  { value: "admin", label: m.role_admin() },
];
const adminCount = $derived(data.users.filter((u) => u.role === "admin").length);
const refresh = () => invalidate("app:users");

// Create
let createOpen = $state(false);
let form = $state({ name: "", email: "", password: "", role: "user" as Role });
let creating = $state(false);

async function create(e: SubmitEvent) {
  e.preventDefault();
  creating = true;
  const ok = await attempt(
    () => post("/admin/users", form),
    m.users_created({ email: form.email }),
  );
  creating = false;
  if (!ok) return;
  createOpen = false;
  form = { name: "", email: "", password: "", role: "user" };
  await refresh();
}

// Invite link
let inviteRoleOpen = $state(false);
let inviteRole = $state<Role>("user");
let invite = $state<CreatedInvite | null>(null);
let inviteOpen = $state(false);

async function createInvite(e: SubmitEvent) {
  e.preventDefault();
  const created = await attempt(() => post<CreatedInvite>("/admin/invites", { role: inviteRole }));
  if (!created) return;
  inviteRoleOpen = false;
  invite = created;
  inviteOpen = true;
}

// Row actions
let target = $state<User | null>(null);
let renameOpen = $state(false);
let passwordOpen = $state(false);
let deleteOpen = $state(false);
let resetTwoFactorOpen = $state(false);
const twoFactorRequired = $derived(
  Boolean(auth.tenant?.two_factor_required || auth.tenant?.two_factor_required_by_instance),
);

async function resetTwoFactor() {
  if (!target) return;
  const name = target.name;
  if (
    await attempt(
      () => post(`/admin/users/${target?.id}/two-factor/reset`),
      m.users_two_factor_reset_done({ name }),
    )
  ) {
    await refresh();
  }
}

// Profile pictures, cropped in the browser like on the profile page.
let avatarInput = $state<HTMLInputElement | null>(null);
let avatarTarget: User | null = null;

async function uploadAvatar(file: File) {
  const u = avatarTarget;
  if (!u) return;
  const ok = await attempt(
    async () =>
      api(`/admin/users/${u.id}/avatar`, { method: "POST", body: await avatarForm(file) }),
    m.users_avatar_updated({ name: u.name }),
  );
  if (ok) await refresh();
}

async function removeAvatar(u: User) {
  const ok = await attempt(
    () => del(`/admin/users/${u.id}/avatar`),
    m.users_avatar_removed({ name: u.name }),
  );
  if (ok) await refresh();
}

async function setRole(u: User, role: string) {
  if (await attempt(() => patch(`/admin/users/${u.id}`, { role }))) await refresh();
}

async function rename(name: string) {
  if (!target) return false;
  const ok = await attempt(() => patch(`/admin/users/${target?.id}`, { name }));
  if (ok) await refresh();
  return Boolean(ok);
}

async function setPassword(password: string) {
  if (!target) return false;
  if (password.length < 8) {
    await attempt(() => Promise.reject(new Error(m.users_password_too_short())));
    return false;
  }
  return Boolean(
    await attempt(
      () => post(`/admin/users/${target?.id}/password`, { password }),
      m.users_password_changed({ name: target.name }),
    ),
  );
}

async function remove() {
  if (!target) return;
  if (
    await attempt(() => del(`/admin/users/${target?.id}`), m.users_deleted({ email: target.email }))
  ) {
    await refresh();
  }
}

const isSelf = (u: User) => u.id === auth.user?.id;
const lastAdmin = (u: User) => u.role === "admin" && adminCount <= 1;
/** Role and deletion are locked for yourself, the last admin and the instance owner. */
const locked = (u: User) => isSelf(u) || lastAdmin(u) || u.superadmin;

function actionsFor(u: User): RowAction[] {
  const open = (dialog: () => void) => () => {
    target = u;
    dialog();
  };
  return [
    { label: m.common_rename(), icon: Pencil, run: open(() => (renameOpen = true)) },
    { label: m.users_set_password(), icon: KeyRound, run: open(() => (passwordOpen = true)) },
    {
      label: m.users_avatar_set(),
      icon: ImageUp,
      run: () => {
        avatarTarget = u;
        avatarInput?.click();
      },
    },
    ...(u.image
      ? [{ label: m.users_avatar_remove(), icon: ImageMinus, run: () => removeAvatar(u) }]
      : []),
    ...(u.twoFactorEnabled && !isSelf(u)
      ? [
          {
            label: m.users_two_factor_reset(),
            icon: ShieldOff,
            run: open(() => (resetTwoFactorOpen = true)),
          },
        ]
      : []),
    ...(locked(u)
      ? []
      : [
          {
            label: m.common_delete(),
            icon: Trash,
            run: open(() => (deleteOpen = true)),
            destructive: true,
            group: true,
          },
        ]),
  ];
}
</script>

<svelte:head><title>{m.admin_tab_users()} · Sammelband</title></svelte:head>

<input
  bind:this={avatarInput}
  type="file"
  accept="image/*"
  class="hidden"
  onchange={(e) => {
    const file = e.currentTarget.files?.[0];
    if (file) void uploadAvatar(file);
    e.currentTarget.value = '';
  }}
>

<div class="mb-8 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="font-heading text-4xl">{m.admin_tab_users()}</h1>
    <p class="mt-2 text-muted-foreground">
      {m.users_description({ sammelband: auth.tenant?.name ?? 'Sammelband' })}
    </p>
  </div>
  <div class="flex flex-wrap gap-2">
    <Button variant="outline" onclick={() => (inviteRoleOpen = true)}
      ><Link />
      {m.invite_link()}</Button
    >
    <Button onclick={() => (createOpen = true)}><UserPlus /> {m.users_new()}</Button>
  </div>
</div>

{#snippet badges(u: User)}
  {#if isSelf(u)}
    <Badge variant="secondary">{m.users_you()}</Badge>
  {/if}
  {#if u.superadmin}
    <Badge variant="outline">{m.users_owner()}</Badge>
  {/if}
  {#if u.twoFactorEnabled}
    <Badge variant="secondary">{m.users_two_factor_badge()}</Badge>
  {:else if twoFactorRequired}
    <Badge variant="outline" class="text-muted-foreground">{m.users_two_factor_pending()}</Badge>
  {/if}
{/snippet}

{#snippet role(u: User)}
  {#if locked(u)}
    <span class="text-sm">{u.role === 'admin' ? m.role_admin() : m.role_user()}</span>
  {:else}
    <SimpleSelect
      label={m.users_role()}
      value={u.role}
      options={ROLES}
      onchange={(v) => setRole(u, v)}
      class="w-28"
    />
  {/if}
{/snippet}

<!-- Phones: one expandable card per user instead of the table. -->
<div class="grid gap-2 sm:hidden">
  {#each data.users as u (u.id)}
    <ExpandableCard actions={actionsFor(u)}>
      {#snippet summary()}
        <div class="flex items-center gap-3">
          <UserAvatar name={u.name} image={u.image} class="size-8 shrink-0 text-[11px]" />
          <div class="min-w-0">
            <p class="truncate font-medium">{u.name}</p>
            <div class="mt-0.5 flex flex-wrap gap-1">{@render badges(u)}</div>
          </div>
        </div>
      {/snippet}
      <dl class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
        <dt class="text-muted-foreground">{m.common_email()}</dt>
        <dd class="min-w-0 break-all">{u.email}</dd>
        <dt class="text-muted-foreground">{m.users_role()}</dt>
        <dd>{@render role(u)}</dd>
        <dt class="text-muted-foreground">{m.common_created()}</dt>
        <dd>{formatDate(u.createdAt)}</dd>
      </dl>
    </ExpandableCard>
  {/each}
</div>

<div class="hidden sm:block">
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.common_name()}</Table.Head>
        <Table.Head>{m.common_email()}</Table.Head>
        <Table.Head>{m.users_role()}</Table.Head>
        <Table.Head>{m.common_created()}</Table.Head>
        <Table.Head class="w-10"></Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each data.users as u (u.id)}
        <Table.Row>
          <Table.Cell class="font-medium">
            <UserAvatar
              name={u.name}
              image={u.image}
              class="mr-2 inline-flex size-7 align-middle text-[10px]"
            />
            {u.name}
            <span class="ml-2 inline-flex gap-2 align-middle">{@render badges(u)}</span>
          </Table.Cell>
          <Table.Cell class="max-w-64 truncate" title={u.email}>{u.email}</Table.Cell>
          <Table.Cell>{@render role(u)}</Table.Cell>
          <Table.Cell class="text-muted-foreground">
            {formatDate(u.createdAt)}
          </Table.Cell>
          <Table.Cell>
            <ActionMenu actions={actionsFor(u)} label={m.users_actions()} />
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
        <Dialog.Title>{m.users_new()}</Dialog.Title>
        <Dialog.Description>{m.users_new_description()}</Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="new-name">{m.common_name()}</Label>
        <Input id="new-name" bind:value={form.name} required maxlength={200} />
      </div>
      <div class="grid gap-2">
        <Label for="new-email">{m.common_email()}</Label>
        <Input id="new-email" type="email" bind:value={form.email} required />
      </div>
      <div class="grid gap-2">
        <Label for="new-password">{m.common_password()}</Label>
        <Input
          id="new-password"
          type="password"
          bind:value={form.password}
          required
          minlength={8}
          autocomplete="new-password"
        />
      </div>
      <div class="grid gap-2">
        <Label>{m.users_role()}</Label>
        <SimpleSelect
          label={m.users_role()}
          value={form.role}
          options={ROLES}
          onchange={(v) => (form.role = v as Role)}
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (createOpen = false)}>{m.common_cancel()}</Button>
        <Button type="submit" disabled={creating}>{m.common_create()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={inviteRoleOpen}>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-4" onsubmit={createInvite}>
      <Dialog.Header>
        <Dialog.Title>{m.users_invite_title()}</Dialog.Title>
        <Dialog.Description>{m.users_invite_description()}</Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label>{m.users_role()}</Label>
        <SimpleSelect
          label={m.users_role()}
          value={inviteRole}
          options={ROLES}
          onchange={(v) => (inviteRole = v as Role)}
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (inviteRoleOpen = false)}
          >{m.common_cancel()}</Button
        >
        <Button type="submit">{m.share_create()}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<InviteLinkDialog bind:open={inviteOpen} {invite} />

<PromptDialog
  bind:open={renameOpen}
  title={m.users_rename_title({ email: target?.email ?? '' })}
  label={m.common_name()}
  value={target?.name ?? ''}
  onsubmit={rename}
/>
<PromptDialog
  bind:open={passwordOpen}
  title={m.users_set_password_title({ name: target?.name ?? '' })}
  label={m.users_set_password_label()}
  submitLabel={m.users_set_password()}
  onsubmit={setPassword}
/>
<ConfirmDialog
  bind:open={resetTwoFactorOpen}
  title={m.users_two_factor_reset_title({ name: target?.name ?? '' })}
  description={m.users_two_factor_reset_description()}
  confirmLabel={m.users_two_factor_reset_confirm()}
  onconfirm={resetTwoFactor}
/>
<ConfirmDialog
  bind:open={deleteOpen}
  title={m.folder_delete_confirm({ name: target?.email ?? '' })}
  description={m.users_delete_description()}
  onconfirm={remove}
/>
