<script lang="ts">
import Trash from "@lucide/svelte/icons/trash-2";
import Upload from "@lucide/svelte/icons/upload";
import { api, del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import SimpleSelect from "$lib/components/app/simple-select.svelte";
import UserAvatar from "$lib/components/app/user-avatar.svelte";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import {
  followBrowserLocale,
  getLocale,
  LOCALE_NAMES,
  type Locale,
  locales,
  m,
  switchLocale,
} from "$lib/i18n";
import { auth } from "$lib/stores/auth.svelte";

// Language: saved with the account, so it follows the user to other devices.
const BROWSER = "browser";
const languageChoice = $derived(auth.user?.locale ?? BROWSER);
const languageOptions = [
  { value: BROWSER, label: m.profile_language_browser({ language: LOCALE_NAMES[getLocale()] }) },
  ...locales.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
];

async function chooseLanguage(value: string) {
  const locale = value === BROWSER ? null : (value as Locale);
  const ok = await attempt(() => patch("/profile", { locale }));
  if (!ok) return;
  if (locale) switchLocale(locale);
  else followBrowserLocale();
}

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
    m.profile_saved(),
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
    await attempt(() => Promise.reject(new Error(m.profile_passwords_mismatch())));
    return;
  }
  savingPassword = true;
  const ok = await attempt(
    () => post("/profile/password", { currentPassword, newPassword }),
    m.profile_password_changed(),
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
  if (!ctx) throw new Error(m.profile_avatar_unsupported());
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
  }, m.profile_avatar_updated());
  uploading = false;
  if (ok) await auth.refresh();
}

async function removeAvatar() {
  if (await attempt(() => del("/profile/avatar"), m.profile_avatar_removed())) await auth.refresh();
}
</script>

<svelte:head><title>{m.nav_profile()} · Sammelband</title></svelte:head>

<h1 class="mb-8 font-heading text-4xl">{m.nav_profile()}</h1>

<div class="grid max-w-2xl gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.language()}</Card.Title>
      <Card.Description>{m.profile_language_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <SimpleSelect
        label={m.language()}
        value={languageChoice}
        options={languageOptions}
        onchange={chooseLanguage}
        class="w-64"
      />
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.profile_avatar()}</Card.Title>
      <Card.Description>{m.profile_avatar_description()}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-wrap items-center gap-4">
      <UserAvatar name={auth.user?.name ?? ''} image={auth.user?.image} class="size-20 text-2xl" />
      <div class="flex gap-2">
        <Button variant="outline" onclick={() => fileInput?.click()} disabled={uploading}>
          <Upload />
          {uploading ? m.common_uploading() : m.profile_avatar_upload()}
        </Button>
        {#if auth.user?.image}
          <Button variant="ghost" onclick={removeAvatar}><Trash /> {m.common_remove()}</Button>
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
      <Card.Title>{m.nav_account()}</Card.Title>
    </Card.Header>
    <Card.Content>
      <form class="grid gap-4" onsubmit={saveAccount}>
        <div class="grid gap-2">
          <Label for="profile-name">{m.common_name()}</Label>
          <Input id="profile-name" bind:value={name} required maxlength={200} autocomplete="name" />
        </div>
        <div class="grid gap-2">
          <Label for="profile-email">{m.common_email()}</Label>
          <Input id="profile-email" type="email" bind:value={email} required autocomplete="email" />
        </div>
        {#if emailChanged}
          <div class="grid gap-2">
            <Label for="profile-email-password">{m.profile_email_password()}</Label>
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
          <Button type="submit" disabled={savingAccount}>{m.common_save()}</Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.common_password()}</Card.Title>
      <Card.Description>{m.profile_password_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form class="grid gap-4" onsubmit={savePassword}>
        <div class="grid gap-2">
          <Label for="current-password">{m.profile_current_password()}</Label>
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
            <Label for="new-password">{m.profile_new_password()}</Label>
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
            <Label for="repeat-password">{m.profile_repeat_password()}</Label>
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
          <Button type="submit" disabled={savingPassword}>{m.profile_change_password()}</Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>
</div>
