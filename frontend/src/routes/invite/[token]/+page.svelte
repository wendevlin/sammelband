<script lang="ts">
import { goto } from "$app/navigation";
import { post } from "$lib/api";
import { attempt } from "$lib/attempt";
import AuthShell from "$lib/components/app/auth-shell.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { auth } from "$lib/stores/auth.svelte";

let { data } = $props();

let name = $state("");
let email = $state("");
let password = $state("");
let busy = $state(false);

async function submit(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  const ok = await attempt(
    () => post(`/invites/${data.token}/accept`, { name, email, password }),
    "Account created. Sign in to continue.",
  );
  busy = false;
  if (ok) await goto("/login");
}

async function signOut() {
  await auth.signOut();
  await goto(location.pathname, { invalidateAll: true });
}
</script>

<svelte:head><title>Invite · Sammelband</title></svelte:head>

{#if !data.invite}
  <AuthShell title="Invite link">
    <Alert.Root variant="destructive">
      <Alert.Description>{data.problem}</Alert.Description>
    </Alert.Root>
    <p class="mt-4 text-sm text-muted-foreground">Ask whoever sent it for a new one.</p>
  </AuthShell>
{:else if auth.user}
  <AuthShell title="Join {data.invite.sammelband}">
    <p class="text-sm text-muted-foreground">
      You're signed in as {auth.user.email}. Sign out to create a new account with this link.
    </p>
    <Button class="mt-4 w-full" variant="outline" onclick={signOut}>Sign out</Button>
  </AuthShell>
{:else}
  <AuthShell
    title="Join {data.invite.sammelband}"
    description={data.invite.role === 'admin'
      ? 'You were invited as the admin of this Sammelband. Create your account.'
      : 'You were invited to this Sammelband. Create your account.'}
  >
    <form class="grid gap-4" onsubmit={submit}>
      <div class="grid gap-2">
        <Label for="name">Name</Label>
        <Input id="name" bind:value={name} required maxlength={200} autocomplete="name" />
      </div>
      <div class="grid gap-2">
        <Label for="email">Email</Label>
        <Input id="email" type="email" bind:value={email} required autocomplete="email" />
      </div>
      <div class="grid gap-2">
        <Label for="password">Password</Label>
        <Input
          id="password"
          type="password"
          bind:value={password}
          required
          minlength={8}
          autocomplete="new-password"
        />
      </div>
      <Button type="submit" disabled={busy}>Create account</Button>
    </form>
  </AuthShell>
{/if}
