<script lang="ts">
import type { SharedAlbum, SharedPhoto } from "@sammelband/shared";
import VideoBadge from "#lib/components/album/video-badge.svelte";
import { imageUrls } from "#lib/images.ts";
import { m } from "#lib/paraglide/messages.js";
import { cn } from "#lib/utils.ts";
import { page } from "$app/state";

/**
 * A PDF's video link: where the QR codes of a printed album lead. The video
 * the code was for (`?v=`) plays at the top, the album's other videos follow.
 */
let { album, videos }: { album: SharedAlbum; videos: SharedPhoto[] } = $props();
const urls = imageUrls();

let chosen = $state<string | null>(null);
const current = $derived(
  videos.find((v) => v.id === (chosen ?? page.url.searchParams.get("v"))) ?? videos[0],
);
const others = $derived(videos.filter((v) => v.id !== current?.id));

function choose(v: SharedPhoto) {
  chosen = v.id;
  const url = new URL(page.url.href);
  url.searchParams.set("v", v.id);
  history.replaceState(history.state, "", url);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
</script>

<article class="mx-auto max-w-4xl">
  <p class="text-sm tracking-wide text-muted-foreground uppercase">{m.public_videos_of()}</p>
  <h1 class="mt-1 font-heading text-4xl leading-tight sm:text-5xl">{album.title}</h1>

  {#if !current}
    <div
      class="mt-10 rounded-2xl border border-dashed px-6 py-16 text-center text-muted-foreground"
    >
      {m.public_videos_none()}
    </div>
  {:else}
    <figure class="mt-8">
      {#key current.id}
        {#if current.video_filename}
          <!-- Uploaded videos come without caption tracks. -->
          <!-- svelte-ignore a11y_media_has_caption -->
          <!-- biome-ignore lint/a11y/useMediaCaption: uploads have no caption tracks -->
          <video
            src={urls.video(current.video_filename)}
            poster={urls.src(current.filename, 1920)}
            controls
            playsinline
            preload="metadata"
            class="max-h-[75dvh] w-full rounded-xl bg-black"
            style:aspect-ratio="{current.width} / {current.height}"
          ></video>
        {:else}
          <div class="relative overflow-hidden rounded-xl bg-muted">
            <img
              src={urls.src(current.filename, 1920)}
              alt={current.caption ?? ""}
              class="max-h-[75dvh] w-full object-contain opacity-60"
            >
            <p
              class="absolute inset-0 flex items-center justify-center p-6 text-center font-medium"
            >
              {current.video_status === "failed"
                ? m.public_video_failed()
                : m.public_video_processing()}
            </p>
          </div>
        {/if}
      {/key}
      {#if current.caption?.trim()}
        <figcaption class="mt-3 text-lg">{current.caption}</figcaption>
      {/if}
    </figure>

    {#if others.length > 0}
      <h2 class="mt-12 mb-4 font-heading text-2xl">{m.public_videos_more()}</h2>
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {#each others as v (v.id)}
          <li>
            <button
              type="button"
              class={cn(
                "group relative block aspect-video w-full overflow-hidden rounded-lg bg-muted text-left",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              )}
              onclick={() => choose(v)}
            >
              <img
                src={urls.src(v.filename, 400)}
                srcset={urls.srcset(v.filename)}
                sizes="(min-width: 640px) 33vw, 50vw"
                alt={v.caption ?? ""}
                loading="lazy"
                class="size-full object-cover transition-transform group-hover:scale-105"
              >
              <VideoBadge photo={v} class="absolute bottom-1.5 left-1.5" />
            </button>
            {#if v.caption?.trim()}
              <p class="mt-1 line-clamp-2 text-sm text-muted-foreground">{v.caption}</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</article>
