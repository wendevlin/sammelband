<script lang="ts">
import { toast } from "svelte-sonner";
import { ApiError, post } from "#lib/api.ts";
import AuthShell from "#lib/components/app/auth-shell.svelte";
import * as Alert from "#lib/components/ui/alert/index.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import { errorText } from "#lib/i18n.ts";
import { m } from "#lib/paraglide/messages.js";
import { goto } from "$app/navigation";
import { page } from "$app/state";

// The link in the mail goes through the server, which sends the browser here
// with ?token=… (or ?error=INVALID_TOKEN when it has expired or was used).
const token = page.url.searchParams.get("token");
let invalid = $state(!token || page.url.searchParams.has("error"));
let password = $state("");
let repeat = $state("");
let busy = $state(false);
let errorMessage = $state<string | null>(null);

async function submit(e: SubmitEvent) {
  e.preventDefault();
  errorMessage = null;
  if (password !== repeat) {
    errorMessage = m.profile_passwords_mismatch();
    return;
  }
  busy = true;
  try {
    await post("/auth/reset-password", { newPassword: password, token });
    toast.success(m.reset_done());
    await goto("/login", { replace: true });
  } catch (err) {
    if (err instanceof ApiError && err.code === "INVALID_TOKEN") invalid = true;
    else errorMessage = errorText(err);
  } finally {
    busy = false;
  }
}
</script>

<svelte:head><title>{m.reset_title()} · Sammelband</title></svelte:head>

{#if invalid}
  <AuthShell title={m.reset_invalid_title()} description={m.error_invalid_token()}>
    <div class="grid gap-2">
      <Button href="/forgot-password">{m.reset_request_new()}</Button>
      <Button variant="link" class="h-auto p-0 text-muted-foreground" href="/login"
        >{m.login_back()}</Button
      >
    </div>
  </AuthShell>
{:else}
  <AuthShell title={m.reset_title()} description={m.reset_description()}>
    <form class="grid gap-4" onsubmit={submit}>
      {#if errorMessage}
        <Alert.Root variant="destructive">
          <Alert.Description>{errorMessage}</Alert.Description>
        </Alert.Root>
      {/if}
      <div class="grid gap-2">
        <Label for="new-password">{m.profile_new_password()}</Label>
        <Input
          id="new-password"
          type="password"
          bind:value={password}
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
          bind:value={repeat}
          required
          minlength={8}
          autocomplete="new-password"
        />
      </div>
      <Button type="submit" disabled={busy}>{m.reset_submit()}</Button>
    </form>
  </AuthShell>
{/if}
