<script lang="ts">
import type { SourceAccount, SourceListing } from "@sammelband/shared";
import { api } from "$lib/api";
import SourceCrumbs from "$lib/components/app/source-crumbs.svelte";
import SourceFolders from "$lib/components/app/source-folders.svelte";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { errorText } from "$lib/i18n";
import { m } from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils";

/** Choose the folder a source account's photo picker opens in (profile page). */
let {
  open = $bindable(false),
  account,
  title,
  onchoose,
}: {
  open?: boolean;
  account: SourceAccount;
  /** The account's name in menus, also the name of its top folder. */
  title: string;
  /** Saves the folder; false keeps the dialog open. */
  onchoose: (location: string) => Promise<boolean>;
} = $props();

let listing = $state<SourceListing | null>(null);
let loading = $state(false);
let saving = $state(false);
let problem = $state<string | null>(null);

async function show(location: string) {
  loading = true;
  problem = null;
  try {
    listing = await api<SourceListing>(
      `/sources/accounts/${account.id}/browse?${new URLSearchParams({ location })}`,
    );
  } catch (err) {
    // The start folder is gone: from the top.
    if (location !== "/") return show("/");
    problem = errorText(err);
  } finally {
    loading = false;
  }
}

$effect(() => {
  if (!open) return;
  listing = null;
  void show(account.start_location ?? "/");
});

async function choose() {
  if (!listing) return;
  saving = true;
  const ok = await onchoose(listing.location);
  saving = false;
  if (ok) open = false;
}
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[85dvh] flex-col gap-4 sm:max-w-3xl">
    <Dialog.Header class="pr-10">
      <Dialog.Title>{m.sources_start_folder()}</Dialog.Title>
      <Dialog.Description>{m.sources_start_folder_description()}</Dialog.Description>
      {#if listing}
        <SourceCrumbs crumbs={listing.crumbs} top={title} onopen={show} />
      {/if}
    </Dialog.Header>
    <div class={cn('-mx-1 min-h-32 flex-1 overflow-y-auto px-1', loading && 'opacity-60')}>
      {#if problem}
        <p class="py-10 text-center text-sm text-destructive">{problem}</p>
      {:else if listing}
        {#if listing.folders.length > 0}
          <SourceFolders folders={listing.folders} onopen={show} />
        {:else}
          <p class="py-10 text-center text-sm text-muted-foreground">{m.sources_no_subfolders()}</p>
        {/if}
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{m.common_cancel()}</Button>
      <Button onclick={choose} disabled={!listing || loading || saving}>
        {m.sources_start_here()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
