<script lang="ts">
import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
import RotateCw from "@lucide/svelte/icons/rotate-cw";
import Undo2 from "@lucide/svelte/icons/undo-2";
import type { Photo, PhotoEdit } from "@sammelband/shared";
import { api, del } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import * as Dialog from "#lib/components/ui/dialog/index.ts";
import { errorText } from "#lib/i18n.ts";
import { m } from "#lib/paraglide/messages.js";
import {
  type Crop,
  dragCrop,
  FULL,
  fitRatio,
  type Handle,
  isEdited,
  nextRotation,
  type Rotation,
  render,
  turnCrop,
  turnedSize,
} from "#lib/photo-edit.ts";
import { cn } from "#lib/utils.ts";

/**
 * Turn and crop a photo. Always from the original, so editing again loses
 * nothing; the result is drawn here at full size (lib/photo-edit.ts) and
 * stored as the photo's image, the original and the edit are kept with it.
 */
let { open = $bindable(false), photo }: { open?: boolean; photo: Photo | null } = $props();

let bitmap = $state<HTMLImageElement | null>(null);
let sourceType = $state("image/jpeg");
let problem = $state<string | null>(null);
let rotate = $state<Rotation>(0);
let crop = $state<Crop>(FULL);
let ratioKey = $state("free");
let busy = $state(false);

// Load the original each time the dialog opens, and start from the stored edit.
$effect(() => {
  if (!open || !photo) return;
  const current = photo;
  let cancelled = false;
  let url: string | null = null;
  bitmap = null;
  problem = null;
  rotate = current.edit?.rotate ?? 0;
  crop = current.edit?.crop ?? FULL;
  ratioKey = "free";
  (async () => {
    try {
      const res = await fetch(`/api/images/${current.source_filename ?? current.filename}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      // An <img>: drawn turned as the camera meant it (EXIF) in every browser.
      const img = new Image();
      url = URL.createObjectURL(blob);
      img.src = url;
      await img.decode();
      if (cancelled) return;
      sourceType = blob.type === "image/png" ? "image/png" : "image/jpeg";
      bitmap = img;
    } catch (e) {
      if (!cancelled) problem = errorText(e);
    }
  })();
  return () => {
    cancelled = true;
    if (url) URL.revokeObjectURL(url);
  };
});

const image = $derived(
  bitmap ? { w: bitmap.naturalWidth, h: bitmap.naturalHeight } : { w: 1, h: 1 },
);
const turned = $derived(turnedSize(image, rotate));

const RATIOS: {
  key: string;
  label: () => string;
  ratio: (t: { w: number; h: number }) => number | null;
}[] = [
  { key: "free", label: m.photo_edit_free, ratio: () => null },
  { key: "original", label: m.photo_edit_original, ratio: (t) => t.w / t.h },
  { key: "1:1", label: () => "1:1", ratio: () => 1 },
  { key: "4:3", label: () => "4:3", ratio: () => 4 / 3 },
  { key: "3:4", label: () => "3:4", ratio: () => 3 / 4 },
  { key: "16:9", label: () => "16:9", ratio: () => 16 / 9 },
  { key: "9:16", label: () => "9:16", ratio: () => 9 / 16 },
];
const ratio = $derived(RATIOS.find((r) => r.key === ratioKey)?.ratio(turned) ?? null);

function chooseRatio(key: string) {
  ratioKey = key;
  const r = RATIOS.find((x) => x.key === key)?.ratio(turned) ?? null;
  // The largest frame of that shape; free keeps the frame as it is.
  if (r !== null) crop = fitRatio(FULL, r, turned);
}

function turn(by: 90 | -90) {
  rotate = nextRotation(rotate, by);
  crop = fitRatio(turnCrop(crop, by), ratioKey === "free" ? null : ratio, turned);
}

function reset() {
  rotate = 0;
  crop = FULL;
  ratioKey = "free";
}

// The preview: the turned image fitted into the space the dialog has.
const EDGE = 16;
let stageW = $state(0);
let stageH = $state(0);
const display = $derived.by(() => {
  if (!stageW || !stageH) return { w: 0, h: 0 };
  // Room around it for the handles on the frame's edges.
  const k = Math.min((stageW - 2 * EDGE) / turned.w, (stageH - 2 * EDGE) / turned.h);
  return { w: Math.floor(turned.w * k), h: Math.floor(turned.h * k) };
});
let preview = $state<HTMLCanvasElement | null>(null);
$effect(() => {
  if (!bitmap || !preview || !display.w) return;
  const dpr = window.devicePixelRatio || 1;
  const drawn = render(bitmap, rotate, null, Math.max(display.w, display.h) * dpr);
  preview.width = drawn.width;
  preview.height = drawn.height;
  preview.getContext("2d")?.drawImage(drawn, 0, 0);
});

// Dragging the frame or one of its handles.
let drag: { handle: Handle; start: Crop; x: number; y: number } | null = null;
function startDrag(e: PointerEvent, handle: Handle) {
  e.preventDefault();
  e.stopPropagation();
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  drag = { handle, start: crop, x: e.clientX, y: e.clientY };
}
function moveDrag(e: PointerEvent) {
  if (!drag || !display.w) return;
  const dx = (e.clientX - drag.x) / display.w;
  const dy = (e.clientY - drag.y) / display.h;
  crop = dragCrop(drag.start, drag.handle, dx, dy, ratio, turned);
}
const endDrag = () => (drag = null);

function nudge(e: KeyboardEvent) {
  const step = e.shiftKey ? 0.05 : 0.01;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = moves[e.key];
  if (!move) return;
  e.preventDefault();
  crop = dragCrop(crop, "move", move[0], move[1], ratio, turned);
}

const HANDLES: { handle: Handle; class: string }[] = [
  { handle: "nw", class: "-top-2 -left-2 cursor-nwse-resize" },
  { handle: "ne", class: "-top-2 -right-2 cursor-nesw-resize" },
  { handle: "sw", class: "-bottom-2 -left-2 cursor-nesw-resize" },
  { handle: "se", class: "-right-2 -bottom-2 cursor-nwse-resize" },
  { handle: "n", class: "-top-2 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { handle: "s", class: "-bottom-2 left-1/2 -translate-x-1/2 cursor-ns-resize" },
  { handle: "w", class: "top-1/2 -left-2 -translate-y-1/2 cursor-ew-resize" },
  { handle: "e", class: "top-1/2 -right-2 -translate-y-1/2 cursor-ew-resize" },
];

async function save() {
  if (!photo || !bitmap) return;
  const target = photo;
  busy = true;
  try {
    if (!isEdited(rotate, crop)) {
      // Nothing changed against the original: show the original again.
      if (target.edit) await attempt(() => del(`/photos/${target.id}/edit`), m.photo_edit_saved());
      open = false;
      return;
    }
    const canvas = render(bitmap, rotate, crop);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, sourceType, 0.92),
    );
    if (!blob) throw new Error("toBlob");
    const edit: PhotoEdit = { rotate, crop };
    const fd = new FormData();
    fd.append(
      "file",
      new File([blob], sourceType === "image/png" ? "edited.png" : "edited.jpg", {
        type: sourceType,
      }),
    );
    fd.append("edit", JSON.stringify(edit));
    const ok = await attempt(
      () => api(`/photos/${target.id}/edit`, { method: "POST", body: fd }),
      m.photo_edit_saved(),
    );
    if (ok) open = false;
  } catch (e) {
    problem = errorText(e);
  } finally {
    busy = false;
  }
}

const pct = (v: number) => `${v * 100}%`;
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[92dvh] flex-col gap-4 p-4 sm:max-w-5xl sm:p-6">
    <Dialog.Header class="pr-10">
      <Dialog.Title>{m.photo_edit()}</Dialog.Title>
      <Dialog.Description class="max-sm:sr-only">{m.photo_edit_hint()}</Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={m.photo_edit_rotate_left()}
        title={m.photo_edit_rotate_left()}
        disabled={!bitmap}
        onclick={() => turn(-90)}
      >
        <RotateCcw />
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={m.photo_edit_rotate_right()}
        title={m.photo_edit_rotate_right()}
        disabled={!bitmap}
        onclick={() => turn(90)}
      >
        <RotateCw />
      </Button>
      <span class="mx-1 h-6 w-px bg-border max-sm:hidden" aria-hidden="true"></span>
      <fieldset class="flex flex-wrap gap-1">
        <legend class="sr-only">{m.photo_edit_aspect()}</legend>
        {#each RATIOS as r (r.key)}
          <Button
            variant={ratioKey === r.key ? "default" : "outline"}
            size="sm"
            aria-pressed={ratioKey === r.key}
            disabled={!bitmap}
            onclick={() => chooseRatio(r.key)}
          >
            {r.label()}
          </Button>
        {/each}
      </fieldset>
      <Button variant="ghost" size="sm" class="ml-auto" disabled={!bitmap} onclick={reset}>
        <Undo2 />
        {m.photo_edit_reset()}
      </Button>
    </div>

    <div
      class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-muted"
      bind:clientWidth={stageW}
      bind:clientHeight={stageH}
    >
      {#if problem}
        <p class="p-6 text-center text-sm text-destructive">{problem}</p>
      {:else if !bitmap}
        <p class="text-sm text-muted-foreground">{m.photo_edit_loading()}</p>
      {:else}
        <div
          class="relative touch-none select-none"
          style:width="{display.w}px"
          style:height="{display.h}px"
        >
          <!-- The photo, darkened outside the frame (clipped to the photo). -->
          <div class="absolute inset-0 overflow-hidden">
            <canvas
              bind:this={preview}
              class="block size-full"
              style:width="{display.w}px"
              style:height="{display.h}px"
            ></canvas>
            <div
              class="pointer-events-none absolute"
              style:left={pct(crop.x)}
              style:top={pct(crop.y)}
              style:width={pct(crop.w)}
              style:height={pct(crop.h)}
              style:box-shadow="0 0 0 9999px rgb(0 0 0 / 0.55)"
            ></div>
          </div>
          <!-- The frame on top, not clipped, so its handles can be reached on the
               photo's edges too; thirds as a guide. -->
          <button
            type="button"
            aria-label={m.photo_edit_frame()}
            class="absolute block cursor-move p-0 outline-2 outline-white focus-visible:outline-primary"
            style:left={pct(crop.x)}
            style:top={pct(crop.y)}
            style:width={pct(crop.w)}
            style:height={pct(crop.h)}
            onpointerdown={(e) => startDrag(e, "move")}
            onpointermove={moveDrag}
            onpointerup={endDrag}
            onpointercancel={endDrag}
            onkeydown={nudge}
          >
            <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
              {#each Array.from({ length: 9 }, (_, i) => i) as i (i)}
                <div
                  class={cn("border-white/40", i % 3 < 2 && "border-r", i < 6 && "border-b")}
                ></div>
              {/each}
            </div>
            {#each HANDLES as h (h.handle)}
              <span
                class={cn(
                  "absolute size-4 rounded-full border-2 border-white bg-primary shadow after:absolute after:-inset-2",
                  h.class,
                )}
                aria-hidden="true"
                onpointerdown={(e) => startDrag(e, h.handle)}
                onpointermove={moveDrag}
                onpointerup={endDrag}
                onpointercancel={endDrag}
              ></span>
            {/each}
          </button>
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{m.common_cancel()}</Button>
      <Button onclick={save} disabled={!bitmap || busy}>
        {busy ? m.photo_edit_saving() : m.common_save()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
