<script lang="ts">
import type { Photo } from "@sammelband/shared";
import { post } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import * as Dialog from "#lib/components/ui/dialog/index.ts";
import { formatDuration, imageUrls } from "#lib/images.ts";
import { m } from "#lib/paraglide/messages.js";

/**
 * Choose a video's still image (its thumbnail, cover and picture in the PDF):
 * play or scrub to the moment, then take that frame.
 */
let { open = $bindable(false), photo }: { open?: boolean; photo: Photo | null } = $props();

const urls = imageUrls();
let video = $state<HTMLVideoElement | null>(null);
let at = $state(0);
let busy = $state(false);

async function take() {
  if (!photo) return;
  busy = true;
  const ms = Math.round(at * 1000);
  const ok = await attempt(
    () => post(`/photos/${photo?.id}/poster`, { ms }),
    m.video_poster_saved(),
  );
  busy = false;
  if (ok) open = false;
}
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>{m.video_poster_title()}</Dialog.Title>
      <Dialog.Description>{m.video_poster_description()}</Dialog.Description>
    </Dialog.Header>
    {#if photo?.video_filename}
      <!-- svelte-ignore a11y_media_has_caption -->
      <!-- biome-ignore lint/a11y/useMediaCaption: uploads have no caption tracks -->
      <video
        bind:this={video}
        bind:currentTime={at}
        src={urls.video(photo.video_filename)}
        poster={urls.src(photo.filename, 1200)}
        controls
        playsinline
        preload="auto"
        class="max-h-[60dvh] w-full rounded-lg bg-black"
        onloadedmetadata={() => {
          if (video && photo?.poster_ms) video.currentTime = photo.poster_ms / 1000;
        }}
      ></video>
    {/if}
    <Dialog.Footer class="items-center">
      <span class="mr-auto text-sm text-muted-foreground tabular-nums">
        {m.video_poster_at({ time: formatDuration(at * 1000) })}
      </span>
      <Button variant="outline" onclick={() => (open = false)}>{m.common_cancel()}</Button>
      <Button
        onclick={() => {
          video?.pause();
          void take();
        }}
        disabled={busy}
      >
        {m.video_poster_take()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
