<script lang="ts">
import { api } from "$lib/api";
import { attempt } from "$lib/attempt";
import SimpleSelect from "$lib/components/app/simple-select.svelte";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
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
  await save({ name }, "Name saved");
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
  await save({ timezone }, "Time zone saved");
  savingZone = false;
}
</script>

<svelte:head><title>General · Admin · Sammelband</title></svelte:head>

<div class="grid max-w-2xl gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>Name</Card.Title>
      <Card.Description>
        Shown in the menu, on invite links and to everyone in this Sammelband.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <form class="flex flex-wrap gap-2" onsubmit={saveName}>
        <Input bind:value={name} required maxlength={100} aria-label="Name" class="max-w-sm" />
        <Button
          type="submit"
          disabled={savingName || !name.trim() || name.trim() === auth.tenant?.name}
        >
          Save
        </Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Time zone</Card.Title>
      <Card.Description>
        Share links with an expiry date stop working at 23:59 of that day in this time zone, for
        everyone in {auth.tenant?.name ?? 'this Sammelband'}.
      </Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      <SimpleSelect
        label="Time zone"
        value={timezone}
        options={zones}
        onchange={(v) => (timezone = v)}
        class="w-72"
      />
      <p class="text-sm text-muted-foreground">Now there: {example}</p>
      {#if browserZone !== timezone}
        <p class="text-sm text-muted-foreground">
          Your browser is set to {browserZone}.
          <Button variant="link" class="h-auto p-0" onclick={() => (timezone = browserZone)}
            >Use it</Button
          >
        </p>
      {/if}
    </Card.Content>
    <Card.Footer>
      <Button onclick={saveZone} disabled={savingZone || timezone === auth.tenant?.timezone}
        >Save</Button
      >
    </Card.Footer>
  </Card.Root>
</div>
