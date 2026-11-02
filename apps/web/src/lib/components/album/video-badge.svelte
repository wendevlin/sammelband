<script lang="ts">
import LoaderCircle from "@lucide/svelte/icons/loader-circle";
import Play from "@lucide/svelte/icons/play";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { Photo } from "@sammelband/shared";
import { formatDuration } from "#lib/images.ts";
import { m } from "#lib/paraglide/messages.js";
import { cn } from "#lib/utils.ts";

/**
 * On a video's thumbnail: a play mark with its length, or that it is still
 * being prepared (converted after the upload), or that that failed. With
 * `onclick` (the editor, while not ready) it is a button that shows details.
 */
let {
  photo,
  class: className,
  onclick,
}: {
  photo: Pick<Photo, "duration_ms" | "video_status">;
  class?: string;
  onclick?: () => void;
} = $props();
</script>

{#snippet content()}
  {#if photo.video_status === "processing"}
    <LoaderCircle class="size-3.5 animate-spin" />
    {m.video_processing()}
  {:else if photo.video_status === "failed"}
    <TriangleAlert class="size-3.5" />
    {m.video_failed()}
  {:else}
    <Play class="size-3 fill-current" />
    {formatDuration(photo.duration_ms ?? 0)}
  {/if}
{/snippet}

{#if onclick}
  <button
    type="button"
    class={cn(
      "flex items-center gap-1 rounded-full bg-black/60 py-0.5 pr-2 pl-1.5 text-xs font-medium text-white tabular-nums hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
      className,
    )}
    title={m.video_status_open()}
    {onclick}
  >
    {@render content()}
  </button>
{:else}
  <span
    class={cn(
      "pointer-events-none flex items-center gap-1 rounded-full bg-black/60 py-0.5 pr-2 pl-1.5 text-xs font-medium text-white tabular-nums",
      className,
    )}
  >
    {@render content()}
  </span>
{/if}
