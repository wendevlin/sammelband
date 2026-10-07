<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import type { SourceCrumb } from "@sammelband/shared";

/** Where a source picker is: the folders from the top down, each one a way back. */
let {
  crumbs,
  top,
  onopen,
}: {
  crumbs: SourceCrumb[];
  /** What the top folder is called (it has no name), e.g. the account's. */
  top: string;
  onopen: (ref: string) => void;
} = $props();

const nameOf = (crumb: SourceCrumb) => crumb.name || top;
</script>

<nav class="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
  {#each crumbs as crumb, i (crumb.ref)}
    {#if i > 0}
      <ChevronRight class="size-3.5 shrink-0" />
    {/if}
    {#if i === crumbs.length - 1}
      <span class="font-medium text-foreground">{nameOf(crumb)}</span>
    {:else}
      <button
        type="button"
        class="rounded-sm hover:text-foreground hover:underline"
        onclick={() => onopen(crumb.ref)}
      >
        {nameOf(crumb)}
      </button>
    {/if}
  {/each}
</nav>
