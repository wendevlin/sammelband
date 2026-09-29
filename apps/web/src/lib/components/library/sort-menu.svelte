<script lang="ts">
import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
import type { SortMode } from "@sammelband/shared";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { m } from "$lib/paraglide/messages.js";

/** "Sort: Newest first" button with the order choices (per user and folder). */
let { value, onchange }: { value: SortMode; onchange: (mode: SortMode) => void } = $props();

const OPTIONS: { value: SortMode; label: string }[] = [
  { value: "created", label: m.sort_created() },
  { value: "name", label: m.sort_name() },
  { value: "modified", label: m.sort_modified() },
  { value: "manual", label: m.sort_manual() },
];
const current = $derived(OPTIONS.find((o) => o.value === value)?.label ?? "");
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" aria-label={m.sort_aria({ order: current })}>
        <ArrowDownUp />
        {current}
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="min-w-48">
    <DropdownMenu.Label>{m.sort_by()}</DropdownMenu.Label>
    <DropdownMenu.RadioGroup {value} onValueChange={(v) => v !== value && onchange(v as SortMode)}>
      {#each OPTIONS as o (o.value)}
        <DropdownMenu.RadioItem value={o.value}>{o.label}</DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>
