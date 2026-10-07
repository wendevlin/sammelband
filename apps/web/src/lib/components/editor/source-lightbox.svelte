<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import ChevronLeft from "@lucide/svelte/icons/chevron-left";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import X from "@lucide/svelte/icons/x";
import type { SourceImage } from "@sammelband/shared";
import { Dialog as DialogPrimitive } from "bits-ui";
import { Button } from "#lib/components/ui/button/index.ts";
import { m } from "#lib/paraglide/messages.js";
import { thumbnailUrl } from "#lib/sources.ts";
import { cn } from "#lib/utils.ts";

/**
 * A photo of a source folder, full screen, to make sure it's the right one
 * before adding it. Only the photo shown loads its large preview; the small
 * one stands in until it's there. Arrows and swipes go to the neighbours.
 */
let {
  index = $bindable<number | null>(null),
  images,
  account,
  isSelected,
  ontoggle,
}: {
  index?: number | null;
  /** The photos with a preview, in the order of the grid. */
  images: SourceImage[];
  account: string;
  isSelected: (image: SourceImage) => boolean;
  ontoggle: (image: SourceImage) => void;
} = $props();

const image = $derived(index === null ? null : (images[index] ?? null));
let loaded = $state<string | null>(null);

function go(step: number) {
  if (index === null || images.length === 0) return;
  index = Math.min(images.length - 1, Math.max(0, index + step));
}

function keydown(e: KeyboardEvent) {
  if (e.key === "ArrowLeft") go(-1);
  else if (e.key === "ArrowRight") go(1);
  else if (e.key === " " && image) {
    e.preventDefault();
    ontoggle(image);
  }
}

let swipeX: number | null = null;
function touchStart(e: TouchEvent) {
  swipeX = e.touches.length === 1 ? e.touches[0].clientX : null;
}
function touchEnd(e: TouchEvent) {
  if (swipeX === null) return;
  const dx = e.changedTouches[0].clientX - swipeX;
  swipeX = null;
  if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
}
</script>

<DialogPrimitive.Root
  open={image !== null}
  onOpenChange={(open) => {
    if (!open) index = null;
  }}
>
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay class="fixed inset-0 z-50 bg-black/95" />
    <DialogPrimitive.Content
      class="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none"
      onkeydown={keydown}
      ontouchstart={touchStart}
      ontouchend={touchEnd}
    >
      {#if image?.thumb}
        <div class="flex items-center gap-2 p-2 sm:p-3">
          <DialogPrimitive.Title class="min-w-0 flex-1 truncate px-2 text-sm">
            {image.name}
            <span class="text-white/60">· {(index ?? 0) + 1} / {images.length}</span>
          </DialogPrimitive.Title>
          <Button
            variant={isSelected(image) ? "default" : "secondary"}
            onclick={() => image && ontoggle(image)}
            aria-pressed={isSelected(image)}
          >
            <Check />
            {isSelected(image) ? m.picker_selected() : m.picker_select()}
          </Button>
          <DialogPrimitive.Close>
            {#snippet child({
              props,
            })}
              <Button
                {...props}
                variant="ghost"
                size="icon"
                class="text-white hover:bg-white/15 hover:text-white"
                aria-label={m.picker_close()}
              >
                <X />
              </Button>
            {/snippet}
          </DialogPrimitive.Close>
        </div>
        <div class="relative min-h-0 flex-1">
          {#key image.ref}
            <img
              src={thumbnailUrl(account, image.thumb, 256)}
              alt=""
              class={cn(
                "absolute inset-0 size-full object-contain blur-sm",
                loaded === image.ref && "invisible",
              )}
            >
            <img
              src={thumbnailUrl(account, image.thumb, 2048)}
              alt={image.name}
              class="absolute inset-0 size-full object-contain"
              onload={() => (loaded = image?.ref ?? null)}
            >
          {/key}
          {#if (index ?? 0) > 0}
            <Button
              variant="ghost"
              size="icon-lg"
              class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
              aria-label={m.picker_previous()}
              onclick={() => go(-1)}
            >
              <ChevronLeft />
            </Button>
          {/if}
          {#if (index ?? 0) < images.length - 1}
            <Button
              variant="ghost"
              size="icon-lg"
              class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white"
              aria-label={m.picker_next()}
              onclick={() => go(1)}
            >
              <ChevronRight />
            </Button>
          {/if}
        </div>
      {/if}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
