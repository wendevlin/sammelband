<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { m } from "$lib/paraglide/messages.js";

/** One step left or right in the grid: reordering without drag and drop (touch, keyboard). */
let { onmove, first, last }: { onmove: (delta: -1 | 1) => void; first: boolean; last: boolean } =
  $props();
</script>

<DropdownMenu.Item disabled={first} onclick={() => onmove(-1)} aria-label={m.move_left()}>
  <ArrowLeft />
  {m.move()}
</DropdownMenu.Item>
<DropdownMenu.Item disabled={last} onclick={() => onmove(1)} aria-label={m.move_right()}>
  <ArrowRight />
  {m.move()}
</DropdownMenu.Item>
