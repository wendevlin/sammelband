<script lang="ts">
import Trash from "@lucide/svelte/icons/trash-2";
import Upload from "@lucide/svelte/icons/upload";
import { api, del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import UserAvatar from "$lib/components/app/user-avatar.svelte";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { auth } from "$lib/stores/auth.svelte";

// Account details
let name = $state(auth.user?.name ?? "");
let email = $state(auth.user?.email ?? "");
let emailPassword = $state("");
let savingAccount = $state(false);
const emailChanged = $derived(email.trim().toLowerCase() !== (auth.user?.email ?? ""));

async function saveAccount(e: SubmitEvent) {
  e.preventDefault();
  savingAccount = true;
  const ok = await attempt(
    () =>
      patch("/profile", {
        name,
        email: emailChanged ? email : undefined,
        currentPassword: emailChanged ? emailPassword : undefined,
      }),
    "Profile saved",
  );
  savingAccount = false;
  if (ok) {
    emailPassword = "";
    await auth.refresh();
  }
}

// Password
let currentPassword = $state("");
let newPassword = $state("");
let repeatPassword = $state("");
let savingPassword = $state(false);

async function savePassword(e: SubmitEvent) {
  e.preventDefault();
  if (newPassword !== repeatPassword) {
    await attempt(() => Promise.reject(new Error("The new passwords don't match")));
    return;
  }
  savingPassword = true;
  const ok = await attempt(
    () => post("/profile/password", { currentPassword, newPassword }),
    "Password changed. Other devices have been signed out.",
  );
  savingPassword = false;
  if (ok) currentPassword = newPassword = repeatPassword = "";
}

// Avatar: cropped to a centered square in the browser, the server re-encodes it.
let fileInput = $state<HTMLInputElement | null>(null);
let uploading = $state(false);

async function squareCrop(file: File, size = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Can't process the image in this browser");
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
}

async function uploadAvatar(file: File) {
  uploading = true;
  const ok = await attempt(async () => {
    const fd = new FormData();
    fd.append("file", new File([await squareCrop(file)], "avatar.jpg", { type: "image/jpeg" }));
    return api("/profile/avatar", { method: "POST", body: fd });
  }, "Avatar updated");
  uploading = false;
  if (ok) await auth.refresh();
}

async function removeAvatar() {
  if (await attempt(() => del("/profile/avatar"), "Avatar removed")) await auth.refresh();
}
</script>

<svelte:head><title>Profile · Sammelband</title></svelte:head>

<h1 class="mb-8 font-heading text-4xl">Profile</h1>

<div class="grid max-w-2xl gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>Avatar</Card.Title>
      <Card.Description>Shown in the menu and to others in your Sammelband.</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-wrap items-center gap-4">
      <UserAvatar name={auth.user?.name ?? ''} image={auth.user?.image} class="size-20 text-2xl" />
      <div class="flex gap-2">
        <Button variant="outline" onclick={() => fileInput?.click()} disabled={uploading}>
          <Upload />
          {uploading ? 'Uploading…' : 'Upload picture'}
        </Button>
        {#if auth.user?.image}
          <Button variant="ghost" onclick={removeAvatar}><Trash /> Remove</Button>
        {/if}
      </div>
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        class="hidden"
        onchange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void uploadAvatar(file);
          e.currentTarget.value = '';
        }}
      >
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Account</Card.Title>
    </Card.Header>
    <Card.Content>
      <form class="grid gap-4" onsubmit={saveAccount}>
        <div class="grid gap-2">
          <Label for="profile-name">Name</Label>
          <Input id="profile-name" bind:value={name} required maxlength={200} autocomplete="name" />
        </div>
        <div class="grid gap-2">
          <Label for="profile-email">Email</Label>
          <Input id="profile-email" type="email" bind:value={email} required autocomplete="email" />
        </div>
        {#if emailChanged}
          <div class="grid gap-2">
            <Label for="profile-email-password"
              >Current password (needed to change the email)</Label
            >
            <Input
              id="profile-email-password"
              type="password"
              bind:value={emailPassword}
              required
              autocomplete="current-password"
            />
          </div>
        {/if}
        <div>
          <Button type="submit" disabled={savingAccount}>Save</Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Password</Card.Title>
      <Card.Description>Changing it signs you out on all other devices.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form class="grid gap-4" onsubmit={savePassword}>
        <div class="grid gap-2">
          <Label for="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            bind:value={currentPassword}
            required
            autocomplete="current-password"
          />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              bind:value={newPassword}
              required
              minlength={8}
              autocomplete="new-password"
            />
          </div>
          <div class="grid gap-2">
            <Label for="repeat-password">Repeat new password</Label>
            <Input
              id="repeat-password"
              type="password"
              bind:value={repeatPassword}
              required
              minlength={8}
              autocomplete="new-password"
            />
          </div>
        </div>
        <div>
          <Button type="submit" disabled={savingPassword}>Change password</Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>
</div>
