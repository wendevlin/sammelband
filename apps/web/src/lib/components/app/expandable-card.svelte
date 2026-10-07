<script lang="ts">
import ChevronDown from "@lucide/svelte/icons/chevron-down";
import type { Snippet } from "svelte";
import { Button } from "#lib/components/ui/button/index.ts";
import type { RowAction } from "./row-actions";

/**
 * A list row on phones, where tables don't fit: the summary line, and on tap
 * the details plus the row's actions as buttons.
 */
let {
  summary,
  children,
  actions = [],
}: { summary: Snippet; children: Snippet; actions?: RowAction[] } = $props();
</script>

<!-- min-w-0: long names truncate instead of widening the card past the page. -->
<details class="group min-w-0 rounded-xl border bg-card">
  <summary
    class="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden"
  >
    <div class="min-w-0 flex-1">{@render summary()}</div>
    <ChevronDown
      class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
    />
  </summary>
  <div class="grid gap-3 border-t px-3 pt-3 pb-3 text-sm">
    {@render children()}
    {#if actions.length > 0}
      <div class="flex flex-wrap gap-2 pt-1">
        {#each actions as action (action.label)}
          <Button
            variant={action.destructive ? "destructive" : "outline"}
            size="sm"
            onclick={action.run}
          >
            <action.icon />
            {action.label}
          </Button>
        {/each}
      </div>
    {/if}
  </div>
</details>
