<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { ExportWarning } from "@sammelband/shared";
import { m } from "#lib/paraglide/messages.js";

/** How a PDF came out: blank pages added, photos cropped a lot. */
let { warnings }: { warnings: ExportWarning[] } = $props();

function text(w: ExportWarning): string {
  const { count } = w.params;
  if (w.code === "blank_pages") {
    return count === 1
      ? m.export_warning_blank_pages_one({ count })
      : m.export_warning_blank_pages_other({ count });
  }
  return count === 1
    ? m.export_warning_photos_cropped_one({ count })
    : m.export_warning_photos_cropped_other({ count });
}
</script>

{#if warnings.length > 0}
  <ul class="grid gap-1 text-sm text-muted-foreground">
    {#each warnings as w (w.code)}
      <li class="flex items-start gap-2">
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <span>{text(w)}</span>
      </li>
    {/each}
  </ul>
{/if}
