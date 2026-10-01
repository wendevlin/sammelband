<script lang="ts">
import Trash from "@lucide/svelte/icons/trash-2";
import Upload from "@lucide/svelte/icons/upload";
import { api, del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import { avatarForm } from "$lib/avatar";
import BackupCodes from "$lib/components/app/backup-codes.svelte";
import SimpleSelect from "$lib/components/app/simple-select.svelte";
import TwoFactorSetup from "$lib/components/app/two-factor-setup.svelte";
import UserAvatar from "$lib/components/app/user-avatar.svelte";
import PasswordDialog from "$lib/components/dialogs/password-dialog.svelte";
import { Badge } from "$lib/components/ui/badge";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import * as Dialog from "$lib/components/ui/dialog";
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

// Two-factor authentication
let settingUpTwoFactor = $state(false);
let newCodesOpen = $state(false);
let disableOpen = $state(false);
let freshCodes = $state<string[]>([]);
const twoFactorRequired = $derived(
  Boolean(auth.tenant?.two_factor_required || auth.tenant?.two_factor_required_by_instance),
);

async function twoFactorSetUp() {
  settingUpTwoFactor = false;
  await auth.refresh();
}

async function newBackupCodes(password: string) {
  const res = await attempt(() =>
    post<{ backupCodes: string[] }>("/auth/two-factor/generate-backup-codes", { password }),
  );
  if (res) freshCodes = res.backupCodes;
  return Boolean(res);
}

function closeCodes() {
  freshCodes = [];
}

async function disableTwoFactor(password: string) {
  const ok = await attempt(
    () => post("/auth/two-factor/disable", { password }),
    m.two_factor_disabled(),
  );
  if (ok) await auth.refresh();
  return Boolean(ok);
}

// Avatar: cropped to a centered square in the browser (avatarForm), re-encoded by the server.
let fileInput = $state<HTMLInputElement | null>(null);
let uploading = $state(false);

async function uploadAvatar(file: File) {
  uploading = true;
  const ok = await attempt(
    async () => api("/profile/avatar", { method: "POST", body: await avatarForm(file) }),
    m.profile_avatar_updated(),
  );
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

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        {m.two_factor_title()}
        {#if auth.user?.twoFactorEnabled}
          <Badge>{m.two_factor_status_on()}</Badge>
        {:else}
          <Badge variant="outline">{m.two_factor_status_off()}</Badge>
        {/if}
      </Card.Title>
      {#if auth.user?.twoFactorEnabled}
        <Card.Description>{m.two_factor_on_description()}</Card.Description>
      {/if}
    </Card.Header>
    <Card.Content class="grid gap-4">
      {#if auth.user?.twoFactorEnabled}
        {#if twoFactorRequired}
          <p class="text-sm text-muted-foreground">
            {auth.tenant?.two_factor_required
              ? m.two_factor_required_note({ sammelband: auth.tenant.name })
              : m.two_factor_required_by_instance_note()}
          </p>
        {/if}
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" onclick={() => (newCodesOpen = true)}
            >{m.two_factor_new_codes()}</Button
          >
          {#if !twoFactorRequired}
            <Button variant="ghost" onclick={() => (disableOpen = true)}
              >{m.two_factor_disable()}</Button
            >
          {/if}
        </div>
      {:else if settingUpTwoFactor}
        <TwoFactorSetup ondone={twoFactorSetUp} oncancel={() => (settingUpTwoFactor = false)} />
      {:else}
        <p class="text-sm text-muted-foreground">{m.two_factor_intro()}</p>
        <div>
          <Button onclick={() => (settingUpTwoFactor = true)}>{m.two_factor_start()}</Button>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

<PasswordDialog
  bind:open={newCodesOpen}
  title={m.two_factor_new_codes()}
  description={m.two_factor_new_codes_description()}
  submitLabel={m.two_factor_new_codes()}
  onsubmit={newBackupCodes}
/>
<PasswordDialog
  bind:open={disableOpen}
  title={m.two_factor_disable()}
  description={m.two_factor_disable_description()}
  submitLabel={m.two_factor_disable()}
  destructive
  onsubmit={disableTwoFactor}
/>
<Dialog.Root open={freshCodes.length > 0} onOpenChange={(open) => open || closeCodes()}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Title class="sr-only">{m.two_factor_backup_title()}</Dialog.Title>
    <BackupCodes codes={freshCodes} />
    <Dialog.Footer>
      <Button onclick={closeCodes}>{m.two_factor_backup_done()}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
