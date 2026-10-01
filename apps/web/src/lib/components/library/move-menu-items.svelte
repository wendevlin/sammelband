<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
import { m } from "$lib/paraglide/messages.js";

/** One step earlier or later in the custom order: reordering without drag and drop (touch, keyboard). */
let { onmove, first, last }: { onmove: (delta: -1 | 1) => void; first: boolean; last: boolean } =
  $props();
</script>

<DropdownMenu.Item disabled={first} onclick={() => onmove(-1)}>
  <ArrowLeft />
  {m.move_earlier()}
</DropdownMenu.Item>
<DropdownMenu.Item disabled={last} onclick={() => onmove(1)}>
  <ArrowRight />
  {m.move_later()}
</DropdownMenu.Item>
