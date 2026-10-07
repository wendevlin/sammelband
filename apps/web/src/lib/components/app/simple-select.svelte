<script lang="ts">
import * as Select from "#lib/components/ui/select/index.ts";

/** Single-value select from a flat option list. */
let {
  value,
  options,
  onchange,
  label,
  class: className = "w-40",
}: {
  value: string;
  options: { value: string; label: string }[];
  onchange: (value: string) => void;
  label?: string;
  class?: string;
} = $props();

const current = $derived(options.find((o) => o.value === value)?.label ?? "");
</script>

<Select.Root type="single" {value} onValueChange={(v) => v !== value && onchange(v)}>
  <Select.Trigger class={className} aria-label={label} size="sm">{current}</Select.Trigger>
  <!-- Tighter corners than the generated default, which looks bubbly on short lists. -->
  <Select.Content class="rounded-lg p-1">
    {#each options as o (o.value)}
      <Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
