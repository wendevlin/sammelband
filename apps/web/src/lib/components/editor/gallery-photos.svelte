<script lang="ts">
import Expand from "@lucide/svelte/icons/expand";
import ImagePlay from "@lucide/svelte/icons/image-play";
import ImagePlus from "@lucide/svelte/icons/image-plus";
import Pencil from "@lucide/svelte/icons/pencil";
import Upload from "@lucide/svelte/icons/upload";
import X from "@lucide/svelte/icons/x";
import type { Photo, SourceAccount } from "@sammelband/shared";
import type PhotoSwipeLightbox from "photoswipe/lightbox";
import "photoswipe/style.css";
import { onMount } from "svelte";
import { toast } from "svelte-sonner";
import { ApiError, api, del, patch, post, upload as uploadFile } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import VideoBadge from "#lib/components/album/video-badge.svelte";
import SourceIcon from "#lib/components/app/source-icon.svelte";
import ConfirmDialog from "#lib/components/dialogs/confirm-dialog.svelte";
import NoticeDialog from "#lib/components/dialogs/notice-dialog.svelte";
import { Button } from "#lib/components/ui/button/index.ts";
import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { errorText } from "#lib/i18n.ts";
import { imageSrc, imageUrls } from "#lib/images.ts";
import { createLightbox } from "#lib/lightbox.ts";
import { enableVideos, slideOf } from "#lib/lightbox-video.ts";
import { m } from "#lib/paraglide/messages.js";
import { accountTitle } from "#lib/sources.ts";
import { sources } from "#lib/stores/sources.svelte.ts";
import { cn } from "#lib/utils.ts";
import { goto } from "$app/navigation";
import { dropPhoto, photoDrag, photoTargetAt, registerGallery } from "./photo-drag.svelte";
import PhotoEditDialog from "./photo-edit-dialog.svelte";
import PosterDialog from "./poster-dialog.svelte";
import SourcePicker from "./source-picker.svelte";
import { touchDrag } from "./touch-drag";
import VideoStatusDialog from "./video-status-dialog.svelte";

/**
 * Photo manager for one section: upload, caption, reorder, delete, view full
 * screen. Photos are dragged with the mouse (HTML5 drag and drop) or, on touch
 * screens, pressed and held, then dragged. The empty section at the end has no
 * id yet; `ensureSection` creates it first.
 */
let {
  sectionId,
  photos,
  ensureSection,
}: {
  sectionId: string | null;
  photos: Photo[];
  ensureSection: () => Promise<string | null>;
} = $props();

let over = $state(false);
// Photo sources (Nextcloud) of this Sammelband, for the "Add photos" menu.
onMount(() => void sources.load());
let picker = $state<{ account: SourceAccount; title: string } | null>(null);
let pickerOpen = $state(false);
function openPicker(account: SourceAccount, title: string) {
  picker = { account, title };
  pickerOpen = true;
}
let uploading = $state(0);
/** While a video is sent: how much of it (0–1). */
let videoProgress = $state<number | null>(null);
let posterTarget = $state<Photo | null>(null);
let posterOpen = $state(false);
let editTarget = $state<Photo | null>(null);
let editOpen = $state(false);
let statusTarget = $state<Photo | null>(null);
let statusOpen = $state(false);
const urls = imageUrls();
let dropTarget = $state<{ id: string; after: boolean } | null>(null);
let deleteTarget = $state<Photo | null>(null);
let deleteOpen = $state(false);
let input = $state<HTMLInputElement | null>(null);
// Upload limits (storage full, photo too large) need more than a passing toast.
let notice = $state<{ title: string; description: string } | null>(null);
let noticeOpen = $state(false);

/** Videos by type, or by name when the browser doesn't know the type (e.g. some .mkv). */
const VIDEO_NAME = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|mts|m2ts)$/i;
const isVideo = (f: File) => f.type.startsWith("video/") || (!f.type && VIDEO_NAME.test(f.name));

async function upload(files: FileList | File[]) {
  const all = Array.from(files);
  const images = all.filter((f) => f.type.startsWith("image/"));
  const videos = all.filter(isVideo);
  if (images.length > 0) await uploadImages(images);
  if (videos.length > 0) await uploadVideos(videos);
}

/**
 * Videos one at a time, each as the body of its own request (they're large),
 * with the progress shown. A failure stops the rest; earlier ones are kept.
 */
async function uploadVideos(list: File[]) {
  uploading = list.length;
  videoProgress = 0;
  let done = 0;
  let reused = 0;
  try {
    const id = sectionId ?? (await ensureSection());
    if (!id) return;
    for (const file of list) {
      const res = await uploadFile<{ deduplicated: boolean }>(
        `/sections/${id}/videos`,
        file,
        (share) => (videoProgress = (done + share) / list.length),
      );
      done++;
      if (res.deduplicated) reused++;
    }
  } catch (e) {
    if (e instanceof ApiError && (e.status === 413 || e.status === 0)) {
      // Without a code, a proxy in front (or Bun's own cap) refused the size,
      // or the connection broke off: no message from the app to show.
      const reason = e.code
        ? errorText(e)
        : e.status === 413
          ? m.upload_video_refused()
          : m.upload_interrupted();
      notice = {
        title:
          e.code === "quota_exceeded"
            ? m.upload_storage_full()
            : e.status === 0
              ? m.upload_failed()
              : m.upload_video_too_large(),
        description: done > 0 ? m.upload_videos_partial({ reason }) : reason,
      };
      noticeOpen = true;
    } else {
      toast.error(errorText(e));
    }
  } finally {
    uploading = 0;
    videoProgress = null;
  }
  if (done === 0) return;
  toast.success(
    (done === 1 ? m.upload_videos_done_one() : m.upload_videos_done_other({ count: done })) +
      (reused ? ` ${m.upload_reused({ count: reused })}` : ""),
  );
}

// Leaving the page would cancel an upload in progress: videos take a while.
$effect(() => {
  if (uploading === 0) return;
  const warn = (e: BeforeUnloadEvent) => e.preventDefault();
  window.addEventListener("beforeunload", warn);
  return () => window.removeEventListener("beforeunload", warn);
});

async function uploadImages(list: File[]) {
  const fd = new FormData();
  for (const f of list) fd.append("files", f);
  uploading = list.length;
  let res: { uploaded: { deduplicated: boolean }[] } | undefined;
  try {
    const id = sectionId ?? (await ensureSection());
    if (!id) return;
    res = await api<{ uploaded: { deduplicated: boolean }[] }>(`/sections/${id}/photos`, {
      method: "POST",
      body: fd,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 413) {
      // A photo over the limit or a full quota stops the server at that photo,
      // and earlier ones are kept. A request over the body limit (payload_too_large,
      // or Bun's own cap without a code) is refused before anything is saved.
      const partial = e.code === "quota_exceeded" || e.code === "file_too_large";
      notice = partial
        ? {
            title: e.code === "quota_exceeded" ? m.upload_storage_full() : m.upload_too_large(),
            description: m.upload_partial({ reason: errorText(e) }),
          }
        : { title: m.upload_request_too_large(), description: m.upload_request_too_large_hint() };
      noticeOpen = true;
    } else {
      toast.error(errorText(e));
    }
    return;
  } finally {
    uploading = 0;
  }
  const dups = res.uploaded.filter((u) => u.deduplicated).length;
  toast.success(
    (res.uploaded.length === 1
      ? m.upload_done_one()
      : m.upload_done_other({ count: res.uploaded.length })) +
      (dups ? ` ${m.upload_reused({ count: dups })}` : ""),
  );
}

async function saveCaption(p: Photo, raw: string) {
  const caption = raw.trim() === "" ? null : raw.trim();
  if (caption === (p.caption ?? null)) return;
  await attempt(() => patch(`/photos/${p.id}`, { caption }));
}

function startDrag(p: Photo) {
  if (sectionId) photoDrag.current = { id: p.id, sectionId };
}

/**
 * Drop the dragged photo (from this or another section) before or after the
 * photo `targetId`, or at the end of this section. One write either way.
 */
async function drop(targetId: string | null, after: boolean) {
  const dragged = photoDrag.current;
  endDrag();
  if (!dragged || dragged.id === targetId) return;
  let beforeId: string | null = null;
  if (targetId) {
    const rest = photos.filter((p) => p.id !== dragged.id);
    beforeId = after ? (rest[rest.findIndex((p) => p.id === targetId) + 1]?.id ?? null) : targetId;
  }
  const id = sectionId ?? (await ensureSection());
  if (!id) return;
  await attempt(() => post(`/photos/${dragged.id}/move`, { sectionId: id, beforeId }));
}

function endDrag() {
  photoDrag.current = null;
  photoDrag.target = null;
  dropTarget = null;
  over = false;
}

// Touch drags: the target under the finger, dropped by the gallery it's in.
const galleryKey = $props.id();
$effect(() => registerGallery(galleryKey, (at) => void drop(at.id, at.after)));

function followFinger(x: number, y: number) {
  photoDrag.target = photoTargetAt(x, y);
}

function endTouchDrag(dropped: boolean) {
  const at = photoDrag.target;
  if (dropped && at) dropPhoto(at);
  endDrag();
}

/** Where the dragged photo would land here: from dragover (mouse) or under the finger (touch). */
const indicator = $derived<{ id: string | null; after: boolean } | null>(
  dropTarget ?? (photoDrag.target?.gallery === galleryKey ? photoDrag.target : null),
);

/** A photo from another section is being dragged over this one. */
const draggingForeign = $derived(
  photoDrag.current !== null && photoDrag.current.sectionId !== sectionId,
);

// The section's photos full screen; swipe or arrow keys to the others.
let lightbox: PhotoSwipeLightbox | null = null;

function view(index: number) {
  if (!lightbox) {
    lightbox = createLightbox();
    enableVideos(lightbox);
    lightbox.init();
  }
  lightbox.loadAndOpen(
    index,
    photos.map((p) => slideOf(p, urls)),
  );
}

$effect(() => () => {
  lightbox?.destroy();
  lightbox = null;
});
</script>

{#if photos.length > 0}
  <ul class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
    {#each photos as p, i (p.id)}
      <li
        class={cn(
          "relative transition-opacity",
          photoDrag.current?.id === p.id && "opacity-40",
          indicator?.id === p.id &&
            (indicator.after ? "border-r-4 border-r-primary" : "border-l-4 border-l-primary"),
        )}
        data-drop-gallery={galleryKey}
        data-drop-photo={p.id}
        ondragover={(e) => {
          if (!photoDrag.current || photoDrag.current.id === p.id) return;
          e.preventDefault();
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          dropTarget = { id: p.id, after: e.clientX > rect.left + rect.width / 2 };
        }}
        ondrop={(e) => {
          e.preventDefault();
          void drop(p.id, dropTarget?.after ?? false);
        }}
      >
        <div
          role="img"
          aria-label={p.caption ?? m.photo()}
          class="group relative aspect-square cursor-grab overflow-hidden rounded-lg bg-muted"
          draggable="true"
          ondragstart={() => startDrag(p)}
          ondragend={endDrag}
          {@attach touchDrag({
            onstart: () => startDrag(p),
            onmove: followFinger,
            onend: endTouchDrag,
          })}
        >
          <img
            src={imageSrc(p.filename, 400)}
            alt={p.caption ?? ""}
            class="size-full object-cover"
            draggable="false"
          >
          {#if p.kind === "video"}
            <VideoBadge
              photo={p}
              class="absolute bottom-1.5 left-1.5"
              onclick={p.video_status === "ready"
                ? undefined
                : () => {
                    statusTarget = p;
                    statusOpen = true;
                  }}
            />
          {/if}
          <!-- Both buttons: always there on touch screens, on hover with a mouse. -->
          <Button
            variant="secondary"
            size="icon-xs"
            class="absolute top-1 right-1 group-hover:opacity-100 after:absolute after:-inset-1.5 focus-visible:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0"
            aria-label={m.photo_delete()}
            onclick={() => {
              deleteTarget = p;
              deleteOpen = true;
            }}
          >
            <X />
          </Button>
          <button
            type="button"
            class="absolute right-1.5 bottom-1.5 flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow transition-opacity group-hover:opacity-100 after:absolute after:-inset-1.5 hover:bg-black/75 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(hover:hover)_and_(pointer:fine)]:size-7 [@media(hover:hover)_and_(pointer:fine)]:opacity-0"
            aria-label={m.photo_view()}
            title={m.photo_view()}
            onclick={() => view(i)}
          >
            <Expand class="size-4" />
          </button>
          {#if p.kind === "image"}
            <button
              type="button"
              class="absolute top-1.5 left-1.5 flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow transition-opacity group-hover:opacity-100 after:absolute after:-inset-1.5 hover:bg-black/75 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(hover:hover)_and_(pointer:fine)]:size-7 [@media(hover:hover)_and_(pointer:fine)]:opacity-0"
              aria-label={m.photo_edit()}
              title={m.photo_edit()}
              onclick={() => {
                editTarget = p;
                editOpen = true;
              }}
            >
              <Pencil class="size-4" />
            </button>
          {/if}
          {#if p.kind === "video" && p.video_status === "ready"}
            <button
              type="button"
              class="absolute top-1.5 left-1.5 flex size-8 items-center justify-center rounded-full bg-black/55 text-white shadow transition-opacity group-hover:opacity-100 after:absolute after:-inset-1.5 hover:bg-black/75 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(hover:hover)_and_(pointer:fine)]:size-7 [@media(hover:hover)_and_(pointer:fine)]:opacity-0"
              aria-label={m.video_poster_title()}
              title={m.video_poster_title()}
              onclick={() => {
                posterTarget = p;
                posterOpen = true;
              }}
            >
              <ImagePlay class="size-4" />
            </button>
          {/if}
        </div>
        <Input
          class="mt-1 h-8 text-xs"
          placeholder={m.photo_caption()}
          value={p.caption ?? ""}
          onchange={(e) => saveCaption(p, e.currentTarget.value)}
        />
      </li>
    {/each}
  </ul>
{/if}

<!-- Drop files here, or click: upload, or (with photo sources) a menu to pick where from. -->
{#snippet zone(triggerProps: Record<string, unknown> | null)}
  <button
    {...triggerProps}
    type="button"
    class={cn(
      "mt-3 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground transition-colors",
      over || indicator?.id === null ? "border-primary bg-muted" : "hover:bg-muted/50",
    )}
    data-drop-gallery={draggingForeign ? galleryKey : undefined}
    ondragover={(e) => {
      if (photoDrag.current && !draggingForeign) return;
      e.preventDefault();
      over = true;
    }}
    ondragleave={() => (over = false)}
    ondrop={(e) => {
      e.preventDefault();
      if (photoDrag.current) {
        if (draggingForeign) void drop(null, false);
        return;
      }
      over = false;
      if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files);
    }}
    onclick={triggerProps ? (triggerProps.onclick as () => void) : () => input?.click()}
    disabled={uploading > 0}
  >
    <ImagePlus class="size-5" />
    {uploading > 0
      ? videoProgress !== null
        ? m.upload_video_progress({ progress: Math.round(videoProgress * 100) })
        : uploading === 1
          ? m.upload_progress_one()
          : m.upload_progress_other({ count: uploading })
      : draggingForeign
        ? m.upload_drop_move()
        : sources.list.length > 0
          ? m.upload_drop_or_pick()
          : m.upload_drop()}
  </button>
{/snippet}

{#if sources.list.length > 0}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        {@render zone(props)}
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="center" class="min-w-56">
      <DropdownMenu.Item onclick={() => input?.click()}>
        <Upload />
        {m.photos_add_upload()}
      </DropdownMenu.Item>
      {#each sources.list as s (s.id)}
        {#each s.accounts as a (a.id)}
          <DropdownMenu.Item onclick={() => openPicker(a, accountTitle(s, a))}>
            <SourceIcon id={s.id} />
            {m.photos_add_from({ source: accountTitle(s, a) })}
          </DropdownMenu.Item>
        {/each}
        {#if s.accounts.length === 0}
          <DropdownMenu.Item onclick={() => goto("/profile#sources")}>
            <SourceIcon id={s.id} />
            {m.photos_add_connect({ source: s.name })}
          </DropdownMenu.Item>
        {/if}
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{:else}
  {@render zone(null)}
{/if}

{#if picker}
  <SourcePicker
    bind:open={pickerOpen}
    account={picker.account}
    title={picker.title}
    {ensureSection}
  />
{/if}
<input
  bind:this={input}
  type="file"
  accept="image/*,video/*"
  multiple
  class="hidden"
  onchange={(e) => {
    const files = e.currentTarget.files;
    if (files) void upload(files);
    e.currentTarget.value = "";
  }}
>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.photo_delete_confirm()}
  description={m.photo_delete_description()}
  onconfirm={() => deleteTarget && attempt(() => del(`/photos/${deleteTarget?.id}`))}
/>

<PosterDialog bind:open={posterOpen} photo={posterTarget} />
<PhotoEditDialog bind:open={editOpen} photo={editTarget} />
<VideoStatusDialog bind:open={statusOpen} photo={statusTarget} />

<NoticeDialog
  bind:open={noticeOpen}
  title={notice?.title ?? ""}
  description={notice?.description}
/>
