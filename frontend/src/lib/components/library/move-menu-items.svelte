<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";

/** One step left or right in the grid: reordering without drag and drop (touch, keyboard). */
let { onmove, first, last }: { onmove: (delta: -1 | 1) => void; first: boolean; last: boolean } =
  $props();
</script>

<DropdownMenu.Item disabled={first} onclick={() => onmove(-1)} aria-label="Move left">
  <ArrowLeft />
  Move
</DropdownMenu.Item>
<DropdownMenu.Item disabled={last} onclick={() => onmove(1)} aria-label="Move right">
  <ArrowRight />
  Move
</DropdownMenu.Item>
