<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import KeyRound from "@lucide/svelte/icons/key-round";
import Link from "@lucide/svelte/icons/link";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash from "@lucide/svelte/icons/trash-2";
import UserPlus from "@lucide/svelte/icons/user-plus";
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
import { auth } from "$lib/stores/auth.svelte";
import type { CreatedInvite, Role, User } from "$lib/types";

let { data } = $props();

const ROLES = [
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
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
  const ok = await attempt(() => post("/admin/users", form), `Created ${form.email}`);
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
    await attempt(() => Promise.reject(new Error("Passwords need at least 8 characters")));
    return false;
  }
  return Boolean(
    await attempt(
      () => post(`/admin/users/${target?.id}/password`, { password }),
      `Password changed. ${target.name} has been signed out everywhere.`,
    ),
  );
}

async function remove() {
  if (!target) return;
  if (await attempt(() => del(`/admin/users/${target?.id}`), `Deleted ${target.email}`)) {
    await refresh();
  }
}

const isSelf = (u: User) => u.id === auth.user?.id;
const lastAdmin = (u: User) => u.role === "admin" && adminCount <= 1;
/** Role and deletion are locked for yourself, the last admin and the instance owner. */
const locked = (u: User) => isSelf(u) || lastAdmin(u) || u.superadmin;
</script>

<svelte:head><title>Users · Sammelband</title></svelte:head>

<div class="mb-8 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="font-heading text-4xl">Users</h1>
    <p class="mt-2 text-muted-foreground">
      Everyone in {auth.tenant?.name ?? 'this Sammelband'} can see and edit all folders and albums.
      Admins also manage users.
    </p>
  </div>
  <div class="flex gap-2">
    <Button variant="outline" onclick={() => (inviteRoleOpen = true)}><Link /> Invite link</Button>
    <Button onclick={() => (createOpen = true)}><UserPlus /> New user</Button>
  </div>
</div>

<Table.Root>
  <Table.Header>
    <Table.Row>
      <Table.Head>Name</Table.Head>
      <Table.Head>Email</Table.Head>
      <Table.Head>Role</Table.Head>
      <Table.Head>Created</Table.Head>
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
            <Badge variant="secondary" class="ml-2">You</Badge>
          {/if}
          {#if u.superadmin}
            <Badge variant="outline" class="ml-2">Owner</Badge>
          {/if}
        </Table.Cell>
        <Table.Cell>{u.email}</Table.Cell>
        <Table.Cell>
          {#if locked(u)}
            <span class="text-sm">{u.role === 'admin' ? 'Admin' : 'User'}</span>
          {:else}
            <SimpleSelect
              label="Role"
              value={u.role}
              options={ROLES}
              onchange={(v) => setRole(u, v)}
              class="w-28"
            />
          {/if}
        </Table.Cell>
        <Table.Cell class="text-muted-foreground">
          {new Date(u.createdAt).toLocaleDateString()}
        </Table.Cell>
        <Table.Cell>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button {...props} variant="ghost" size="icon-sm" aria-label="User actions">
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
                Rename
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onclick={() => {
									target = u;
									passwordOpen = true;
								}}
              >
                <KeyRound />
                Set password
              </DropdownMenu.Item>
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
        <Dialog.Title>New user</Dialog.Title>
        <Dialog.Description>Share the password with them yourself.</Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="new-name">Name</Label>
        <Input id="new-name" bind:value={form.name} required maxlength={200} />
      </div>
      <div class="grid gap-2">
        <Label for="new-email">Email</Label>
        <Input id="new-email" type="email" bind:value={form.email} required />
      </div>
      <div class="grid gap-2">
        <Label for="new-password">Password</Label>
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
        <Label>Role</Label>
        <SimpleSelect
          label="Role"
          value={form.role}
          options={ROLES}
          onchange={(v) => (form.role = v as Role)}
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
        <Button type="submit" disabled={creating}>Create</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={inviteRoleOpen}>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-4" onsubmit={createInvite}>
      <Dialog.Header>
        <Dialog.Title>Invite someone</Dialog.Title>
        <Dialog.Description>
          They get a link to create their own account and choose their password.
        </Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label>Role</Label>
        <SimpleSelect
          label="Role"
          value={inviteRole}
          options={ROLES}
          onchange={(v) => (inviteRole = v as Role)}
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (inviteRoleOpen = false)}>Cancel</Button>
        <Button type="submit">Create link</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<InviteLinkDialog bind:open={inviteOpen} {invite} />

<PromptDialog
  bind:open={renameOpen}
  title="Rename {target?.email ?? ''}"
  label="Name"
  value={target?.name ?? ''}
  onsubmit={rename}
/>
<PromptDialog
  bind:open={passwordOpen}
  title="Set password for {target?.name ?? ''}"
  label="New password (at least 8 characters)"
  submitLabel="Set password"
  onsubmit={setPassword}
/>
<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete {target?.email ?? ''}?"
  description="Their folders, albums and photos stay in the library."
  onconfirm={remove}
/>
