<script lang="ts">
import { post } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import AuthShell from "#lib/components/app/auth-shell.svelte";
import { Button } from "#lib/components/ui/button/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import { m } from "#lib/paraglide/messages.js";
import { auth } from "#lib/stores/auth.svelte.ts";
import { browserTimeZone } from "#lib/timezone.ts";
import { goto } from "$app/navigation";
import { page } from "$app/state";

let code = $state(page.url.searchParams.get("code") ?? "");
let sammelband = $state("");
let name = $state("");
let email = $state("");
let password = $state("");
let busy = $state(false);

async function submit(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  const ok = await attempt(
    () =>
      post("/onboarding/claim", {
        code,
        sammelband,
        email,
        password,
        name: name || undefined,
        timezone: browserTimeZone(),
      }),
    m.setup_done(),
  );
  busy = false;
  if (!ok) return;
  auth.needsOnboarding = false;
  await goto("/login", { refreshAll: true });
}
</script>

<AuthShell
  title={m.setup_title()}
  description={auth.multiTenant ? m.setup_description_multi() : m.setup_description()}
>
  <form class="grid gap-4" onsubmit={submit}>
    <div class="grid gap-2">
      <Label for="code">{m.setup_code()}</Label>
      <Input id="code" bind:value={code} required autocomplete="off" class="font-mono uppercase" />
    </div>
    <div class="grid gap-2">
      <Label for="sammelband">{m.setup_sammelband_name()}</Label>
      <Input
        id="sammelband"
        bind:value={sammelband}
        required
        maxlength={100}
        placeholder={m.setup_sammelband_placeholder()}
      />
    </div>
    <div class="grid gap-2">
      <Label for="name">{m.common_your_name()}</Label>
      <Input id="name" bind:value={name} autocomplete="name" />
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
    <Button type="submit" disabled={busy}>{m.common_create()}</Button>
  </form>
</AuthShell>
