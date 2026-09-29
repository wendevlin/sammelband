<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { ApiError, safeNext } from "$lib/api";
import AuthShell from "$lib/components/app/auth-shell.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { errorText } from "$lib/i18n";
import { m } from "$lib/paraglide/messages.js";
import { auth } from "$lib/stores/auth.svelte";

let email = $state("");
let password = $state("");
let busy = $state(false);
let errorMessage = $state<string | null>(null);

async function submit(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  errorMessage = null;
  try {
    await auth.signIn(email, password);
    await goto(safeNext(page.url), { invalidateAll: true, replaceState: true });
  } catch (err) {
    errorMessage =
      err instanceof ApiError && err.status === 401 && !err.code
        ? m.error_invalid_email_or_password()
        : errorText(err);
  } finally {
    busy = false;
  }
}
</script>

<AuthShell title={m.login_title()} description={m.login_description()}>
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
    <div class="grid gap-2">
      <Label for="password">{m.common_password()}</Label>
      <Input
        id="password"
        type="password"
        bind:value={password}
        required
        autocomplete="current-password"
      />
    </div>
    <Button type="submit" disabled={busy}>{m.login_submit()}</Button>
  </form>
</AuthShell>
