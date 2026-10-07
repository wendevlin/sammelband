<script lang="ts">
import type { TenantInfo } from "@sammelband/shared";
import { api } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import SimpleSelect from "#lib/components/app/simple-select.svelte";
import { Button } from "#lib/components/ui/button/index.ts";
import * as Card from "#lib/components/ui/card/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import { Switch } from "#lib/components/ui/switch/index.ts";
import { m } from "#lib/paraglide/messages.js";
import { auth } from "#lib/stores/auth.svelte.ts";
import { browserTimeZone, formatInZone } from "#lib/timezone.ts";

/** Settings of the admin's own Sammelband. */
async function save(
  patch: {
    name?: string;
    timezone?: string;
    twoFactorRequired?: boolean;
    pdfExportEnabled?: boolean;
  },
  message: string,
) {
  const updated = await attempt(
    () => api<TenantInfo>("/tenant", { method: "PATCH", body: patch }),
    message,
  );
  if (updated) auth.tenant = updated;
  return Boolean(updated);
}

// Name
let name = $state(auth.tenant?.name ?? "");
let savingName = $state(false);
async function saveName(e: SubmitEvent) {
  e.preventDefault();
  savingName = true;
  await save({ name }, m.general_name_saved());
  savingName = false;
}

// Time zone
const zones = Intl.supportedValuesOf("timeZone").map((z) => ({
  value: z,
  label: z.replaceAll("_", " "),
}));
const browserZone = browserTimeZone();
let timezone = $state(auth.tenant?.timezone ?? browserZone);
let savingZone = $state(false);
const example = $derived(formatInZone(Date.now(), timezone));
async function saveZone() {
  savingZone = true;
  await save({ timezone }, m.general_timezone_saved());
  savingZone = false;
}

// Two-factor authentication for everyone. The server refuses to turn it on for
// admins who don't use it themselves; the switch then flips back.
let twoFactorRequired = $state(auth.tenant?.two_factor_required ?? false);
let savingTwoFactor = $state(false);
async function saveTwoFactor(required: boolean) {
  savingTwoFactor = true;
  const ok = await save(
    { twoFactorRequired: required },
    required ? m.general_two_factor_on() : m.general_two_factor_off(),
  );
  if (!ok) twoFactorRequired = !required;
  savingTwoFactor = false;
}

// PDF export of albums.
let pdfExport = $state(auth.tenant?.pdf_export_enabled ?? false);
let savingPdfExport = $state(false);
async function savePdfExport(enabled: boolean) {
  savingPdfExport = true;
  const ok = await save(
    { pdfExportEnabled: enabled },
    enabled ? m.general_pdf_export_on() : m.general_pdf_export_off(),
  );
  if (!ok) pdfExport = !enabled;
  savingPdfExport = false;
}
</script>

<svelte:head
  ><title>{m.admin_tab_general()} · {m.nav_admin_settings()} · Sammelband</title></svelte:head
>

<div class="grid max-w-2xl gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.common_name()}</Card.Title>
      <Card.Description>{m.general_name_description()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form class="flex flex-wrap gap-2" onsubmit={saveName}>
        <Input
          bind:value={name}
          required
          maxlength={100}
          aria-label={m.common_name()}
          class="max-w-sm"
        />
        <Button
          type="submit"
          disabled={savingName || !name.trim() || name.trim() === auth.tenant?.name}
        >
          {m.common_save()}
        </Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.general_timezone()}</Card.Title>
      <Card.Description>
        {m.general_timezone_description({ sammelband: auth.tenant?.name ?? "Sammelband" })}
      </Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <SimpleSelect
        label={m.general_timezone()}
        value={timezone}
        options={zones}
        onchange={(v) => (timezone = v)}
        class="w-72"
      />
      <p class="text-sm text-muted-foreground">{m.general_timezone_now({ time: example })}</p>
      {#if browserZone !== timezone}
        <p class="text-sm text-muted-foreground">
          {m.general_timezone_browser({ zone: browserZone })}
          <Button variant="link" class="h-auto p-0" onclick={() => (timezone = browserZone)}
            >{m.general_timezone_use()}</Button
          >
        </p>
      {/if}
    </Card.Content>
    <Card.Footer>
      <Button onclick={saveZone} disabled={savingZone || timezone === auth.tenant?.timezone}
        >{m.common_save()}</Button
      >
    </Card.Footer>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.two_factor_title()}</Card.Title>
      <Card.Description>
        {m.general_two_factor_description({ sammelband: auth.tenant?.name ?? "Sammelband" })}
      </Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <div class="flex items-center justify-between gap-4">
        <Label for="two-factor-required">{m.general_two_factor_switch()}</Label>
        <Switch
          id="two-factor-required"
          bind:checked={twoFactorRequired}
          disabled={savingTwoFactor}
          onCheckedChange={saveTwoFactor}
        />
      </div>
      {#if auth.tenant?.two_factor_required_by_instance}
        <p class="text-sm text-muted-foreground">{m.general_two_factor_by_instance()}</p>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.general_pdf_export_title()}</Card.Title>
      <Card.Description>
        {m.general_pdf_export_description({ sammelband: auth.tenant?.name ?? "Sammelband" })}
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <div class="flex items-center justify-between gap-4">
        <Label for="pdf-export">{m.general_pdf_export_switch()}</Label>
        <Switch
          id="pdf-export"
          bind:checked={pdfExport}
          disabled={savingPdfExport}
          onCheckedChange={savePdfExport}
        />
      </div>
    </Card.Content>
  </Card.Root>
</div>
