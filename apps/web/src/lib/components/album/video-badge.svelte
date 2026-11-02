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
 * being prepared (converted after the upload), or that that failed.
 */
let {
  photo,
  class: className,
}: { photo: Pick<Photo, "duration_ms" | "video_status">; class?: string } = $props();
</script>

<span
  class={cn(
    "pointer-events-none flex items-center gap-1 rounded-full bg-black/60 py-0.5 pr-2 pl-1.5 text-xs font-medium text-white tabular-nums",
    className,
  )}
>
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
</span>
