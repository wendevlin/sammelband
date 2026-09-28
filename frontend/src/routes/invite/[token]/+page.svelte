<script lang="ts">
import { goto } from "$app/navigation";
import { post } from "$lib/api";
import { attempt } from "$lib/attempt";
import AuthShell from "$lib/components/app/auth-shell.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { m } from "$lib/paraglide/messages.js";
import { auth } from "$lib/stores/auth.svelte";

let { data } = $props();

let name = $state("");
// Admin invites: the new admin may rename the Sammelband right away.
// svelte-ignore state_referenced_locally
let sammelband = $state(data.invite?.sammelband ?? "");
let email = $state("");
let password = $state("");
let busy = $state(false);

async function submit(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  const ok = await attempt(
    () =>
      post(`/invites/${data.token}/accept`, {
        name,
        email,
        password,
        sammelband: data.invite?.role === "admin" ? sammelband : undefined,
      }),
    m.invite_account_created(),
  );
  busy = false;
  if (ok) await goto("/login");
}

async function signOut() {
  await auth.signOut();
  await goto(location.pathname, { invalidateAll: true });
}
</script>

<svelte:head><title>{m.invite_link()} · Sammelband</title></svelte:head>

{#if !data.invite}
  <AuthShell title={m.invite_link()}>
    <Alert.Root variant="destructive">
      <Alert.Description>{data.problem}</Alert.Description>
    </Alert.Root>
    <p class="mt-4 text-sm text-muted-foreground">{m.invite_ask_new()}</p>
  </AuthShell>
{:else if auth.user}
  <AuthShell title={m.invite_join({ name: data.invite.sammelband })}>
    <p class="text-sm text-muted-foreground">
      {m.invite_signed_in({ email: auth.user.email })}
    </p>
    <Button class="mt-4 w-full" variant="outline" onclick={signOut}>{m.nav_sign_out()}</Button>
  </AuthShell>
{:else}
  <AuthShell
    title={data.invite.role === 'admin'
      ? m.invite_admin_title()
      : m.invite_join({ name: data.invite.sammelband })}
    description={data.invite.role === 'admin' ? m.invite_admin_description() : m.invite_user_description()}
  >
    <form class="grid gap-4" onsubmit={submit}>
      {#if data.invite.role === 'admin'}
        <div class="grid gap-2">
          <Label for="sammelband">{m.invite_sammelband_name()}</Label>
          <Input id="sammelband" bind:value={sammelband} required maxlength={100} />
          <p class="text-xs text-muted-foreground">{m.invite_sammelband_hint()}</p>
        </div>
      {/if}
      <div class="grid gap-2">
        <Label for="name">{m.common_your_name()}</Label>
        <Input id="name" bind:value={name} required maxlength={200} autocomplete="name" />
      </div>
      <div class="grid gap-2">
        <Label for="email">{m.common_email()}</Label>
        <Input id="email" type="email" bind:value={email} required autocomplete="email" />
      </div>
      <div class="grid gap-2">
        <Label for="password">{m.common_password()}</Label>
        <Input
          id="password"
          type="password"
          bind:value={password}
          required
          minlength={8}
          autocomplete="new-password"
        />
      </div>
      <Button type="submit" disabled={busy}>{m.invite_create_account()}</Button>
    </form>
  </AuthShell>
{/if}
