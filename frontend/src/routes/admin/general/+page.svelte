<script lang="ts">
import { api } from "$lib/api";
import { attempt } from "$lib/attempt";
import SimpleSelect from "$lib/components/app/simple-select.svelte";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { auth } from "$lib/stores/auth.svelte";
import { browserTimeZone, formatInZone } from "$lib/timezone";
import type { TenantInfo } from "$lib/types";

const zones = Intl.supportedValuesOf("timeZone").map((z) => ({
  value: z,
  label: z.replaceAll("_", " "),
}));
const browserZone = browserTimeZone();
let timezone = $state(auth.tenant?.timezone ?? browserZone);
let saving = $state(false);
const example = $derived(formatInZone(Date.now(), timezone));

async function save() {
  saving = true;
  const updated = await attempt(
    () => api<TenantInfo>("/tenant", { method: "PATCH", body: { timezone } }),
    "Time zone saved",
  );
  saving = false;
  if (updated) auth.tenant = updated;
}
</script>

<svelte:head><title>General · Admin · Sammelband</title></svelte:head>

<div class="grid max-w-2xl gap-6">
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
      <Button onclick={save} disabled={saving || timezone === auth.tenant?.timezone}>Save</Button>
    </Card.Footer>
  </Card.Root>
</div>
