<script lang="ts">
import { post } from "#lib/api.ts";
import AuthShell from "#lib/components/app/auth-shell.svelte";
import * as Alert from "#lib/components/ui/alert/index.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import { errorText } from "#lib/i18n.ts";
import { m } from "#lib/paraglide/messages.js";
import { page } from "$app/state";

// The answer is the same whether the address has an account or not.
let email = $state(page.url.searchParams.get("email") ?? "");
let busy = $state(false);
let sent = $state(false);
let errorMessage = $state<string | null>(null);

async function submit(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  errorMessage = null;
  try {
    await post("/auth/request-password-reset", {
      email: email.trim(),
      redirectTo: `${location.origin}/reset-password`,
    });
    sent = true;
  } catch (err) {
    errorMessage = errorText(err);
  } finally {
    busy = false;
  }
}
</script>

<svelte:head><title>{m.forgot_title()} · Sammelband</title></svelte:head>

{#if sent}
  <AuthShell title={m.forgot_sent_title()}>
    <div class="grid gap-4">
      <p class="text-sm text-muted-foreground">{m.forgot_sent({ email: email.trim() })}</p>
      <Button variant="outline" href="/login">{m.login_back()}</Button>
    </div>
  </AuthShell>
{:else}
  <AuthShell title={m.forgot_title()} description={m.forgot_description()}>
    <form class="grid gap-4" onsubmit={submit}>
      {#if errorMessage}
        <Alert.Root variant="destructive">
          <Alert.Description>{errorMessage}</Alert.Description>
        </Alert.Root>
      {/if}
      <div class="grid gap-2">
        <Label for="email">{m.common_email()}</Label>
        <Input id="email" type="email" bind:value={email} required autocomplete="email" />
      </div>
      <Button type="submit" disabled={busy}>{m.forgot_submit()}</Button>
      <Button variant="link" class="h-auto p-0 text-muted-foreground" href="/login"
        >{m.login_back()}</Button
      >
    </form>
  </AuthShell>
{/if}
