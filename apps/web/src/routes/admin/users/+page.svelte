<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import KeyRound from "@lucide/svelte/icons/key-round";
import Link from "@lucide/svelte/icons/link";
import Pencil from "@lucide/svelte/icons/pencil";
import ShieldOff from "@lucide/svelte/icons/shield-off";
import Trash from "@lucide/svelte/icons/trash-2";
import UserPlus from "@lucide/svelte/icons/user-plus";
import type { CreatedInvite, Role, User } from "@sammelband/shared";
import { invalidate } from "$app/navigation";
import { del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import SimpleSelect from "$lib/components/app/simple-select.svelte";
import UserAvatar from "$lib/components/app/user-avatar.svelte";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import InviteLinkDialog from "$lib/components/dialogs/invite-link-dialog.svelte";
import PromptDialog from "$lib/components/dialogs/prompt-dialog.svelte";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
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
</script>

<svelte:head><title>{m.admin_tab_users()} · Sammelband</title></svelte:head>

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
          {#if isSelf(u)}
            <Badge variant="secondary" class="ml-2">{m.users_you()}</Badge>
          {/if}
          {#if u.superadmin}
            <Badge variant="outline" class="ml-2">{m.users_owner()}</Badge>
          {/if}
          {#if u.twoFactorEnabled}
            <Badge variant="secondary" class="ml-2">{m.users_two_factor_badge()}</Badge>
          {:else if twoFactorRequired}
            <Badge variant="outline" class="ml-2 text-muted-foreground"
              >{m.users_two_factor_pending()}</Badge
            >
          {/if}
        </Table.Cell>
        <Table.Cell>{u.email}</Table.Cell>
        <Table.Cell>
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
        </Table.Cell>
        <Table.Cell class="text-muted-foreground">
          {formatDate(u.createdAt)}
        </Table.Cell>
        <Table.Cell>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon-sm" aria-label={m.users_actions()}>
                  <EllipsisVertical />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item
                onclick={() => {
									target = u;
									renameOpen = true;
								}}
              >
                <Pencil />
                {m.common_rename()}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onclick={() => {
									target = u;
									passwordOpen = true;
								}}
              >
                <KeyRound />
                {m.users_set_password()}
              </DropdownMenu.Item>
              {#if u.twoFactorEnabled && !isSelf(u)}
                <DropdownMenu.Item
                  onclick={() => {
										target = u;
										resetTwoFactorOpen = true;
									}}
                >
                  <ShieldOff />
                  {m.users_two_factor_reset()}
                </DropdownMenu.Item>
              {/if}
              {#if !locked(u)}
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  variant="destructive"
                  onclick={() => {
										target = u;
										deleteOpen = true;
									}}
                >
                  <Trash />
                  {m.common_delete()}
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
