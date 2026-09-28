<script lang="ts">
import { api } from "$lib/api";
import { attempt } from "$lib/attempt";
import SimpleSelect from "$lib/components/app/simple-select.svelte";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { m } from "$lib/paraglide/messages.js";
import { auth } from "$lib/stores/auth.svelte";
import { browserTimeZone, formatInZone } from "$lib/timezone";
import type { TenantInfo } from "$lib/types";

/** Settings of the admin's own Sammelband. */
async function save(patch: { name?: string; timezone?: string }, message: string) {
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
        {m.general_timezone_description({ sammelband: auth.tenant?.name ?? 'Sammelband' })}
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
</div>
