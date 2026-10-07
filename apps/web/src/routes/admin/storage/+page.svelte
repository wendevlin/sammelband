<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { post } from "$lib/api";
import { attempt } from "$lib/attempt";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { formatBytes } from "$lib/images";
import { live } from "$lib/live.svelte";
import { m } from "$lib/paraglide/messages.js";
import { auth } from "$lib/stores/auth.svelte";

let { data } = $props();
let clearOpen = $state(false);

live(
  () => ["storage-stats"],
  () => "app:storage",
);

const quota = $derived(data.stats.quota);
const tiles = $derived([
  {
    label: m.storage_used(),
    value: formatBytes(quota.used_bytes),
    hint:
      quota.limit_bytes === null
        ? m.storage_no_limit()
        : m.storage_of_limit({ limit: formatBytes(quota.limit_bytes) }),
  },
  {
    label: m.storage_originals(),
    value: formatBytes(data.stats.originals.size_bytes),
    hint: m.storage_files({ count: data.stats.originals.file_count }),
  },
  {
    label: m.storage_cache(),
    value: formatBytes(data.stats.variants.size_bytes),
    hint: m.storage_files({ count: data.stats.variants.file_count }),
  },
  {
    label: m.storage_exports(),
    value: formatBytes(data.stats.exports.size_bytes),
    hint: m.storage_files({ count: data.stats.exports.file_count }),
  },
]);
const orphans = $derived(data.stats.orphans.missing_on_disk + data.stats.orphans.unknown_on_disk);
</script>

<svelte:head><title>{m.admin_tab_storage()} · Sammelband</title></svelte:head>

<h1 class="font-heading text-4xl">{m.admin_tab_storage()}</h1>
<p class="mt-2 mb-8 text-muted-foreground">
  {m.storage_description({ sammelband: auth.tenant?.name ?? 'Sammelband' })}
</p>

<div class="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
  {#each tiles as t (t.label)}
    <Card.Root>
      <Card.Header>
        <Card.Description>{t.label}</Card.Description>
        <Card.Title class="text-3xl">{t.value}</Card.Title>
      </Card.Header>
      <Card.Content class="truncate text-xs text-muted-foreground">{t.hint}</Card.Content>
    </Card.Root>
  {/each}
</div>

{#if orphans > 0}
  <Alert.Root class="mb-8">
    <TriangleAlert />
    <Alert.Title>{m.storage_orphans_title()}</Alert.Title>
    <Alert.Description>
      {m.storage_orphans({
        missing: data.stats.orphans.missing_on_disk,
        unknown: data.stats.orphans.unknown_on_disk,
      })}
    </Alert.Description>
  </Alert.Root>
{/if}

<Card.Root>
  <Card.Header>
    <Card.Title>{m.storage_cache_title()}</Card.Title>
    <Card.Description>{m.storage_cache_description()}</Card.Description>
  </Card.Header>
  <Card.Footer>
    <Button variant="outline" onclick={() => (clearOpen = true)}>{m.storage_clear_cache()}</Button>
  </Card.Footer>
</Card.Root>

<ConfirmDialog
  bind:open={clearOpen}
  title={m.storage_clear_confirm()}
  description={m.storage_clear_description()}
  confirmLabel={m.storage_clear_cache()}
  onconfirm={() => attempt(() => post('/admin/storage/clear-cache'), m.storage_cache_cleared())}
/>
