<script lang="ts">
import type { Photo, VideoProgress } from "@sammelband/shared";
import { ApiError, api } from "#lib/api.ts";
import * as Dialog from "#lib/components/ui/dialog/index.ts";
import { errorText } from "#lib/i18n.ts";
import { formatBytes, formatDuration } from "#lib/images.ts";
import { m } from "#lib/paraglide/messages.js";

/**
 * Where a video is with its conversion: waiting (behind how many), being
 * converted (how far, how fast, the CPU and memory it takes), done or failed.
 * Asks the server again every moment while open.
 */
let { open = $bindable(false), photo }: { open?: boolean; photo: Photo | null } = $props();

let info = $state<VideoProgress | null>(null);
let problem = $state<string | null>(null);

$effect(() => {
  if (!open || !photo) return;
  const id = photo.id;
  info = null;
  problem = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      info = await api<VideoProgress>(`/photos/${id}/video`);
      problem = null;
    } catch (e) {
      problem = errorText(e);
      // Deleted meanwhile: asking again won't change that.
      if (e instanceof ApiError && e.status === 404) return;
    }
    // Once done there's nothing more to follow.
    if (!stopped && info?.status !== "ready" && info?.status !== "failed") {
      timer = setTimeout(poll, 1500);
    }
  };
  void poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
});

const percent = (share: number) => `${Math.round(share * 100)} %`;
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>
        {info?.status === "ready"
          ? m.video_status_title_ready()
          : info?.status === "failed"
            ? m.video_status_title_failed()
            : m.video_status_title_processing()}
      </Dialog.Title>
      {#if photo?.caption}
        <Dialog.Description>{photo.caption}</Dialog.Description>
      {/if}
    </Dialog.Header>

    {#if problem}
      <p class="text-sm text-destructive">{problem}</p>
    {:else if !info}
      <p class="text-sm text-muted-foreground">…</p>
    {:else if info.status === "ready"}
      <p class="text-sm">{m.video_status_ready()}</p>
    {:else if info.status === "failed"}
      <p class="text-sm">{m.video_status_failed()}</p>
    {:else if info.running}
      <div class="grid gap-3 text-sm" aria-live="polite">
        <p>{info.running.mode === "copy" ? m.video_status_copy() : m.video_status_encode()}</p>
        <div
          class="h-2 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={info.running.progress === null
            ? undefined
            : Math.round(info.running.progress * 100)}
        >
          <div
            class="h-full rounded-full bg-primary transition-[width] duration-700"
            style:width="{Math.max(3, (info.running.progress ?? 0) * 100)}%"
          ></div>
        </div>
        <p class="text-muted-foreground tabular-nums">
          {info.running.progress === null
            ? ""
            : `${percent(info.running.progress)} · `}{m.video_status_elapsed({
            time: formatDuration(info.running.elapsed_ms),
          })}{info.running.remaining_ms === null
            ? ""
            : ` · ${m.video_status_remaining({ time: formatDuration(info.running.remaining_ms) })}`}{info
            .running.speed === null
            ? ""
            : ` · ${m.video_status_speed({ speed: info.running.speed.toFixed(1) })}`}
        </p>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border p-3 tabular-nums">
          <dt class="text-muted-foreground">{m.video_status_cpu()}</dt>
          <dd>
            {info.running.cpu_percent === null
              ? m.video_status_unknown()
              : m.video_status_cpu_value({
                  percent: info.running.cpu_percent,
                  max: info.cores * 100,
                  cores: info.cores,
                })}
          </dd>
          <dt class="text-muted-foreground">{m.video_status_memory()}</dt>
          <dd>
            {info.running.memory_bytes === null
              ? m.video_status_unknown()
              : formatBytes(info.running.memory_bytes)}
          </dd>
          {#if info.duration_ms}
            <dt class="text-muted-foreground">{m.video_status_length()}</dt>
            <dd>{formatDuration(info.duration_ms)}</dd>
          {/if}
        </dl>
      </div>
    {:else}
      <div class="grid gap-2 text-sm" aria-live="polite">
        <p>
          {info.waiting === null || info.waiting === 0
            ? m.video_status_next()
            : info.waiting === 1
              ? m.video_status_waiting_one()
              : m.video_status_waiting_other({ count: info.waiting })}
        </p>
        {#if info.upload_bytes !== null}
          <p class="text-muted-foreground">
            {m.video_status_upload({ size: formatBytes(info.upload_bytes) })}
          </p>
        {/if}
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
