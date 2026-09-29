<script lang="ts">
import { renderSVG } from "uqr";
import { post } from "$lib/api";
import { attempt } from "$lib/attempt";
import BackupCodes from "$lib/components/app/backup-codes.svelte";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { m } from "$lib/paraglide/messages.js";

/**
 * Turning on two-factor authentication: confirm the password, scan the QR
 * code, prove it with a first code, then save the backup codes. `ondone`
 * runs after the last step; the session only reflects the change once the
 * caller refreshes it (auth.refresh()).
 */
let { ondone, oncancel }: { ondone: () => void; oncancel?: () => void } = $props();

let step = $state<"password" | "scan" | "codes">("password");
let password = $state("");
let code = $state("");
let busy = $state(false);
let uri = $state("");
let backupCodes = $state<string[]>([]);

// The QR code as an image (no markup injected into the page); dark on light
// in both themes, as scanners expect.
const qr = $derived(
  uri ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSVG(uri))}` : "",
);
/** The key for typing it in by hand, in groups of four. */
const key = $derived(
  (new URL(uri || "otpauth://x").searchParams.get("secret") ?? "").replace(/(.{4})/g, "$1 ").trim(),
);

async function start(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  const res = await attempt(() =>
    post<{ totpURI: string; backupCodes: string[] }>("/auth/two-factor/enable", {
      password,
      method: "totp",
    }),
  );
  busy = false;
  if (!res) return;
  password = "";
  uri = res.totpURI;
  backupCodes = res.backupCodes;
  step = "scan";
}

async function verify(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  const ok = await attempt(
    () => post("/auth/two-factor/verify-totp", { code: code.replace(/\s/g, "") }),
    m.two_factor_enabled_done(),
  );
  busy = false;
  if (ok) step = "codes";
}
</script>

{#if step === 'password'}
  <form class="grid gap-4" onsubmit={start}>
    <p class="text-sm text-muted-foreground">{m.two_factor_intro()}</p>
    <div class="grid gap-2">
      <Label for="two-factor-password">{m.two_factor_password_label()}</Label>
      <Input
        id="two-factor-password"
        type="password"
        bind:value={password}
        required
        autocomplete="current-password"
      />
    </div>
    <div class="flex gap-2">
      <Button type="submit" disabled={busy || !password}>{m.two_factor_continue()}</Button>
      {#if oncancel}
        <Button variant="outline" onclick={oncancel}>{m.common_cancel()}</Button>
      {/if}
    </div>
  </form>
{:else if step === 'scan'}
  <form class="grid gap-4" onsubmit={verify}>
    <p class="text-sm">{m.two_factor_scan()}</p>
    <img
      src={qr}
      alt={m.two_factor_qr_alt()}
      class="size-48 justify-self-center rounded-lg bg-white p-2"
    >
    <div class="text-sm text-muted-foreground">
      <p>{m.two_factor_manual_key()}</p>
      <p class="mt-1 font-mono text-foreground select-all break-all">{key}</p>
    </div>
    <div class="grid gap-2">
      <Label for="two-factor-code">{m.login_code_label()}</Label>
      <Input
        id="two-factor-code"
        bind:value={code}
        required
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength={9}
        class="font-mono tracking-widest"
      />
    </div>
    <div class="flex gap-2">
      <Button type="submit" disabled={busy || code.replace(/\s/g, '').length < 6}
        >{m.two_factor_enable()}</Button
      >
      {#if oncancel}
        <Button variant="outline" onclick={oncancel}>{m.common_cancel()}</Button>
      {/if}
    </div>
  </form>
{:else}
  <div class="grid gap-4">
    <BackupCodes codes={backupCodes} />
    <div><Button onclick={ondone}>{m.two_factor_backup_done()}</Button></div>
  </div>
{/if}
