<script lang="ts">
import Share from "@lucide/svelte/icons/share-2";
import type { ShareLinkInfo } from "@sammelband/shared";
import { api } from "$lib/api";
import { Button } from "$lib/components/ui/button";
import { m } from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils";
import ShareDialog from "./share-dialog.svelte";
import { shareStatus } from "./share-status";

/**
 * "Share" button with a dot for existing links (green: active, amber: all
 * expired). `open` also opens the dialog from elsewhere, e.g. a mobile menu
 * while `class` hides the button there.
 */
let {
  target,
  name,
  open = $bindable(false),
  class: className,
}: {
  target: { albumId: string } | { folderId: string };
  name: string;
  open?: boolean;
  class?: string;
} = $props();

let links = $state<ShareLinkInfo[]>([]);
const query = $derived(
  "albumId" in target ? `albumId=${target.albumId}` : `folderId=${target.folderId}`,
);
const status = $derived(shareStatus(links));

async function load() {
  links = await api<ShareLinkInfo[]>(`/shares?${query}`).catch(() => []);
}

$effect(() => {
  void query;
  void load();
});
</script>

<Button
  variant="outline"
  class={className}
  onclick={() => (open = true)}
  aria-label={status === 'active'
    ? m.share_aria_active()
    : status === 'expired'
      ? m.share_aria_expired()
      : m.share()}
>
  <Share />
  {m.share()}
  {#if status !== 'none'}
    <span
      class={cn(
        'size-2 rounded-full',
        status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
      )}
      title={status === 'active' ? m.share_status_active() : m.share_status_expired()}
    ></span>
  {/if}
</Button>

<ShareDialog bind:open {target} {name} {links} onchange={load} />
