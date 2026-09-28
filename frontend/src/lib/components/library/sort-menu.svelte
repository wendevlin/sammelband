<script lang="ts">
import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import type { SortMode } from "$lib/types";

/** "Sort: Newest first" button with the order choices (per user and folder). */
let { value, onchange }: { value: SortMode; onchange: (mode: SortMode) => void } = $props();

const OPTIONS: { value: SortMode; label: string }[] = [
  { value: "created", label: "Newest first" },
  { value: "name", label: "Name" },
  { value: "modified", label: "Recently changed" },
  { value: "manual", label: "Manual" },
];
const current = $derived(OPTIONS.find((o) => o.value === value)?.label ?? "");
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" aria-label="Sort order: {current}">
        <ArrowDownUp />
        {current}
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-48">
    <DropdownMenu.Label>Sort by</DropdownMenu.Label>
    <DropdownMenu.RadioGroup {value} onValueChange={(v) => v !== value && onchange(v as SortMode)}>
      {#each OPTIONS as o (o.value)}
        <DropdownMenu.RadioItem value={o.value}>{o.label}</DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>
