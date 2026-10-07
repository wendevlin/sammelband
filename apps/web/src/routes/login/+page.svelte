<script lang="ts">
import { ApiError, safeNext } from "#lib/api.ts";
import AuthShell from "#lib/components/app/auth-shell.svelte";
import * as Alert from "#lib/components/ui/alert/index.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import { Switch } from "#lib/components/ui/switch/index.ts";
import { errorText } from "#lib/i18n.ts";
import { m } from "#lib/paraglide/messages.js";
import { auth } from "#lib/stores/auth.svelte.ts";
import { goto } from "$app/navigation";
import { page } from "$app/state";

let email = $state("");
let password = $state("");
let busy = $state(false);
let errorMessage = $state<string | null>(null);

// Second step for accounts with two-factor authentication.
let step = $state<"password" | "code">("password");
let code = $state("");
let backup = $state(false);
let trustDevice = $state(false);

const finish = () => goto(safeNext(page.url), { refreshAll: true, replace: true });

async function submit(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  errorMessage = null;
  try {
    if ((await auth.signIn(email, password)) === "two-factor") {
      step = "code";
      password = "";
    } else {
      await finish();
    }
  } catch (err) {
    errorMessage =
      err instanceof ApiError && err.status === 401 && !err.code
        ? m.error_invalid_email_or_password()
        : errorText(err);
  } finally {
    busy = false;
  }
}

async function submitCode(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  errorMessage = null;
  try {
    await auth.verifyCode(code, { backup, trustDevice });
    await finish();
  } catch (err) {
    errorMessage = errorText(err);
    code = "";
  } finally {
    busy = false;
  }
}

function toggleBackup() {
  backup = !backup;
  code = "";
  errorMessage = null;
}

function back() {
  step = "password";
  code = "";
  backup = false;
  errorMessage = null;
}
</script>

{#if step === "password"}
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
        <div class="flex items-baseline justify-between gap-2">
          <Label for="password">{m.common_password()}</Label>
          {#if auth.mail}
            <a
              href="/forgot-password{email ? `?email=${encodeURIComponent(email)}` : ""}"
              class="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >{m.login_forgot()}</a
            >
          {/if}
        </div>
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
{:else}
  <AuthShell
    title={m.login_code_title()}
    description={backup ? m.login_backup_description() : m.login_code_description()}
  >
    <form class="grid gap-4" onsubmit={submitCode}>
      {#if errorMessage}
        <Alert.Root variant="destructive">
          <Alert.Description>{errorMessage}</Alert.Description>
        </Alert.Root>
      {/if}
      <div class="grid gap-2">
        <Label for="code">{backup ? m.login_backup_label() : m.login_code_label()}</Label>
        <Input
          id="code"
          bind:value={code}
          required
          autocomplete="one-time-code"
          inputmode={backup ? "text" : "numeric"}
          maxlength={backup ? 20 : 9}
          class="font-mono tracking-widest"
        />
      </div>
      <div class="flex items-center justify-between gap-4">
        <Label for="trust-device" class="font-normal">{m.login_trust_device()}</Label>
        <Switch id="trust-device" bind:checked={trustDevice} />
      </div>
      <Button type="submit" disabled={busy || !code.trim()}>{m.login_verify()}</Button>
      <div class="flex flex-wrap justify-between gap-2 text-sm">
        <Button variant="link" class="h-auto p-0" onclick={toggleBackup}>
          {backup ? m.login_use_app() : m.login_use_backup()}
        </Button>
        <Button variant="link" class="h-auto p-0 text-muted-foreground" onclick={back}>
          {m.login_back()}
        </Button>
      </div>
    </form>
  </AuthShell>
{/if}
