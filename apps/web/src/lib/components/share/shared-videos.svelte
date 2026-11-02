<script lang="ts">
import Volume2 from "@lucide/svelte/icons/volume-2";
import X from "@lucide/svelte/icons/x";
import type { SharedAlbum, SharedPhoto } from "@sammelband/shared";
import { onMount } from "svelte";
import VideoBadge from "#lib/components/album/video-badge.svelte";
import { imageUrls } from "#lib/images.ts";
import { m } from "#lib/paraglide/messages.js";
import { cn } from "#lib/utils.ts";
import { page } from "$app/state";

/**
 * A PDF's video link: where the QR codes of a printed album lead. The video a
 * code is for (`?v=`) opens at once, filling the screen, and plays. Browsers
 * only allow sound and real fullscreen after a tap: without one the video
 * starts muted, and the first tap turns the sound on and goes fullscreen.
 * Behind it, the album's videos as a list; each opens the same way.
 */
let { album, videos }: { album: SharedAlbum; videos: SharedPhoto[] } = $props();
const urls = imageUrls();

const playable = (v: SharedPhoto | undefined): v is SharedPhoto & { video_filename: string } =>
  !!v?.video_filename;

let playingId = $state<string | null>(null);
const playing = $derived(videos.find((v) => v.id === playingId));
let overlay = $state<HTMLElement | null>(null);
let video = $state<HTMLVideoElement | null>(null);
let muted = $state(false);

onMount(() => {
  const asked = videos.find((v) => v.id === page.url.searchParams.get("v"));
  if (playable(asked)) playingId = asked.id;
});

/** Remember the open video in the address, so reloading opens it again. */
function setParam(id: string | null) {
  const url = new URL(page.url.href);
  if (id) url.searchParams.set("v", id);
  else url.searchParams.delete("v");
  history.replaceState(history.state, "", url);
}

/** From a tap: open the video and go fullscreen, with sound. */
function open(v: SharedPhoto) {
  if (!playable(v)) return;
  playingId = v.id;
  muted = false;
  setParam(v.id);
  enterFullscreen();
}

function close() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  video?.pause();
  playingId = null;
  setParam(null);
}

function enterFullscreen() {
  // Must run in the tap's handler. iPhones only let the video itself go fullscreen.
  const target = overlay ?? document.documentElement;
  if (target.requestFullscreen) {
    void target.requestFullscreen().catch(() => {});
  } else {
    (
      video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    )?.webkitEnterFullscreen?.();
  }
}

/** Start playing; where sound needs a tap first, start muted. */
async function start(el: HTMLVideoElement) {
  try {
    el.muted = muted;
    await el.play();
  } catch {
    muted = true;
    el.muted = true;
    await el.play().catch(() => {});
  }
}

function unmute() {
  muted = false;
  if (video) {
    video.muted = false;
    void video.play().catch(() => {});
  }
  enterFullscreen();
}

// No page scrolling behind the player.
$effect(() => {
  if (!playing) return;
  const before = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return () => {
    document.body.style.overflow = before;
  };
});
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && playing && !document.fullscreenElement) close();
  }}
/>

<article class="mx-auto max-w-4xl">
  <p class="text-sm tracking-wide text-muted-foreground uppercase">{m.public_videos_of()}</p>
  <h1 class="mt-1 font-heading text-4xl leading-tight sm:text-5xl">{album.title}</h1>

  {#if videos.length === 0}
    <div
      class="mt-10 rounded-2xl border border-dashed px-6 py-16 text-center text-muted-foreground"
    >
      {m.public_videos_none()}
    </div>
  {:else}
    <ul class="mt-8 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
      {#each videos as v (v.id)}
        <li>
          <button
            type="button"
            class={cn(
              "group relative block aspect-video w-full overflow-hidden rounded-xl bg-muted text-left",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              !playable(v) && "cursor-default",
            )}
            onclick={() => open(v)}
            disabled={!playable(v)}
            aria-label={v.caption ?? m.video_play()}
          >
            <img
              src={urls.src(v.filename, 800)}
              srcset={urls.srcset(v.filename)}
              sizes="(min-width: 640px) 50vw, 100vw"
              alt=""
              loading="lazy"
              class={cn(
                "size-full object-cover transition-transform group-hover:scale-105",
                !playable(v) && "opacity-60",
              )}
            >
            <VideoBadge photo={v} class="absolute bottom-2 left-2" />
          </button>
          {#if v.caption?.trim()}
            <p class="mt-2">{v.caption}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</article>

{#if playable(playing)}
  <div
    bind:this={overlay}
    class="fixed inset-0 z-50 flex flex-col bg-black text-white"
    role="dialog"
    aria-modal="true"
    aria-label={playing.caption ?? album.title}
  >
    {#key playing.id}
      <!-- svelte-ignore a11y_media_has_caption -->
      <!-- biome-ignore lint/a11y/useMediaCaption: uploads have no caption tracks -->
      <video
        bind:this={video}
        src={urls.video(playing.video_filename)}
        poster={urls.src(playing.filename, 1920)}
        controls
        playsinline
        autoplay
        preload="auto"
        class="min-h-0 w-full flex-1 object-contain"
        {@attach (el) => void start(el)}
      ></video>
    {/key}
    {#if playing.caption?.trim()}
      <p class="px-6 pt-2 pb-5 text-center text-base sm:text-lg">{playing.caption}</p>
    {/if}
    <button
      type="button"
      class="absolute top-3 right-3 flex size-11 items-center justify-center rounded-full bg-black/60 hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      aria-label={m.common_close()}
      title={m.common_close()}
      onclick={close}
    >
      <X class="size-6" />
    </button>
    {#if muted}
      <button
        type="button"
        class="absolute top-3 left-3 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-lg focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
        onclick={unmute}
      >
        <Volume2 class="size-5" />
        {m.public_video_unmute()}
      </button>
    {/if}
  </div>
{/if}
