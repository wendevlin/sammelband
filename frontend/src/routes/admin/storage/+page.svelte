<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { post } from "$lib/api";
import { attempt } from "$lib/attempt";
import ConfirmDialog from "$lib/components/app/confirm-dialog.svelte";
import * as Alert from "$lib/components/ui/alert";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { formatBytes } from "$lib/images";
import { live } from "$lib/live.svelte";

let { data } = $props();
let clearOpen = $state(false);

live(
  () => ["storage-stats"],
  () => "app:storage",
);

const tiles = $derived([
  { label: "Database", value: formatBytes(data.stats.db.size_bytes), hint: data.stats.db.path },
  {
    label: "Originals",
    value: formatBytes(data.stats.originals.size_bytes),
    hint: `${data.stats.originals.file_count} files`,
  },
  {
    label: "Resized cache",
    value: formatBytes(data.stats.variants.size_bytes),
    hint: `${data.stats.variants.file_count} files`,
  },
]);
const orphans = $derived(data.stats.orphans.missing_on_disk + data.stats.orphans.unknown_on_disk);
</script>

<svelte:head><title>Storage · Sammelband</title></svelte:head>

<h1 class="mb-8 font-heading text-4xl">Storage</h1>

<div class="mb-8 grid gap-4 sm:grid-cols-3">
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
    <Alert.Title>Files and database disagree</Alert.Title>
    <Alert.Description>
      {data.stats.orphans.missing_on_disk}
      image(s) are missing on disk and
      {data.stats.orphans.unknown_on_disk}
      file(s) on disk are unknown to the database.
    </Alert.Description>
  </Alert.Root>
{/if}

<Card.Root>
  <Card.Header>
    <Card.Title>Resized image cache</Card.Title>
    <Card.Description>
      Resized versions are generated on first view and cached. Clearing frees disk space; they are
      regenerated when needed.
    </Card.Description>
  </Card.Header>
  <Card.Footer>
    <Button variant="outline" onclick={() => (clearOpen = true)}>Clear cache</Button>
  </Card.Footer>
</Card.Root>

<ConfirmDialog
  bind:open={clearOpen}
  title="Clear the resized image cache?"
  description="Originals are kept. The next page views will be slower while images are resized again."
  confirmLabel="Clear cache"
  onconfirm={() => attempt(() => post('/admin/storage/clear-cache'), 'Cache cleared')}
/>
