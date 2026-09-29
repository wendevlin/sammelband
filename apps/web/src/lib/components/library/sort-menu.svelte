<script lang="ts" module>
import type { SortMode as Mode } from "@sammelband/shared";
import { m as messages } from "$lib/paraglide/messages.js";

/** The sort orders a container offers, for this menu and the mobile page menu. */
export const SORT_OPTIONS: { value: Mode; label: string }[] = [
  { value: "created", label: messages.sort_created() },
  { value: "name", label: messages.sort_name() },
  { value: "modified", label: messages.sort_modified() },
  { value: "manual", label: messages.sort_manual() },
];
</script>

<script lang="ts">
import ArrowDownUp from "@lucide/svelte/icons/arrow-down-up";
import type { SortMode } from "@sammelband/shared";
import { Button } from "$lib/components/ui/button";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { m } from "$lib/paraglide/messages.js";

/** "Sort: Newest first" button with the order choices (per user and folder). */
let { value, onchange }: { value: SortMode; onchange: (mode: SortMode) => void } = $props();

const current = $derived(SORT_OPTIONS.find((o) => o.value === value)?.label ?? "");
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
      {#each SORT_OPTIONS as o (o.value)}
        <DropdownMenu.RadioItem value={o.value}>{o.label}</DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>
