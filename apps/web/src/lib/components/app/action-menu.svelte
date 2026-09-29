<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import type { RowAction } from "./row-actions";

/** A row's actions behind a "⋯" button. */
let { actions, label }: { actions: RowAction[]; label: string } = $props();
</script>

{#if actions.length > 0}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="ghost" size="icon-sm" aria-label={label}>
          <EllipsisVertical />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end">
      {#each actions as action, i (action.label)}
        {#if i > 0 && action.group}
          <DropdownMenu.Separator />
        {/if}
        <DropdownMenu.Item
          variant={action.destructive ? 'destructive' : 'default'}
          onclick={action.run}
        >
          <action.icon />
          {action.label}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
