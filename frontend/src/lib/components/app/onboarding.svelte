<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { post } from "$lib/api";
import { attempt } from "$lib/attempt";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { auth } from "$lib/stores/auth.svelte";
import AuthShell from "./auth-shell.svelte";

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
    () => post("/onboarding/claim", { code, sammelband, email, password, name: name || undefined }),
    "Your Sammelband is ready. Sign in to continue.",
  );
  busy = false;
  if (!ok) return;
  auth.needsOnboarding = false;
  await goto("/login", { invalidateAll: true });
}
</script>

<AuthShell
  title="Set up Sammelband"
  description="Use the setup code printed in the server log when it started. You become the owner of this instance and can later create Sammelbände for others."
>
  <form class="grid gap-4" onsubmit={submit}>
    <div class="grid gap-2">
      <Label for="code">Setup code</Label>
      <Input id="code" bind:value={code} required autocomplete="off" class="font-mono uppercase" />
    </div>
    <div class="grid gap-2">
      <Label for="sammelband">Name of your Sammelband</Label>
      <Input
        id="sammelband"
        bind:value={sammelband}
        required
        maxlength={100}
        placeholder="e.g. Our family"
      />
    </div>
    <div class="grid gap-2">
      <Label for="name">Your name</Label>
      <Input id="name" bind:value={name} autocomplete="name" />
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
    <Button type="submit" disabled={busy}>Create</Button>
  </form>
</AuthShell>
