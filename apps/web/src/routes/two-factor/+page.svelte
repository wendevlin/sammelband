<script lang="ts">
import { safeNext } from "#lib/api.ts";
import AuthShell from "#lib/components/app/auth-shell.svelte";
import TwoFactorSetup from "#lib/components/app/two-factor-setup.svelte";
import { Button } from "#lib/components/ui/button/index.ts";
import { m } from "#lib/paraglide/messages.js";
import { auth } from "#lib/stores/auth.svelte.ts";
import { goto } from "$app/navigation";
import { page } from "$app/state";

// Where two-factor authentication is required, users without it land here
// (root layout) and can't reach anything else until it's set up.
const description = $derived(
  auth.tenant?.two_factor_required
    ? m.two_factor_setup_required_tenant({ sammelband: auth.tenant.name })
    : m.two_factor_setup_required_instance(),
);

async function done() {
  await auth.refresh();
  await goto(safeNext(page.url), { refreshAll: true, replace: true });
}

async function signOut() {
  await auth.signOut();
  await goto("/login", { refreshAll: true });
}
</script>

<svelte:head><title>{m.two_factor_setup_title()} · Sammelband</title></svelte:head>

<AuthShell title={m.two_factor_setup_title()} {description}>
  <TwoFactorSetup ondone={done} />
  <div class="mt-6 border-t pt-4 text-center">
    <Button variant="link" class="h-auto p-0 text-muted-foreground" onclick={signOut}
      >{m.nav_sign_out()}</Button
    >
  </div>
</AuthShell>
