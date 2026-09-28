<script lang="ts">
import ImagePlus from "@lucide/svelte/icons/image-plus";
import X from "@lucide/svelte/icons/x";
import { toast } from "svelte-sonner";
import { ApiError, api, del, patch, post } from "$lib/api";
import { attempt } from "$lib/attempt";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import NoticeDialog from "$lib/components/dialogs/notice-dialog.svelte";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { imageSrc } from "$lib/images";
import type { Photo } from "$lib/types";
import { cn } from "$lib/utils";
import { photoDrag } from "./photo-drag.svelte";

/** Photo manager for one gallery block: upload, caption, reorder, delete. */
let { blockId, photos }: { blockId: string; photos: Photo[] } = $props();

let over = $state(false);
let uploading = $state(0);
let dropTarget = $state<{ id: string; after: boolean } | null>(null);
let deleteTarget = $state<Photo | null>(null);
let deleteOpen = $state(false);
let input = $state<HTMLInputElement | null>(null);
// Upload limits (storage full, photo too large) need more than a passing toast.
let notice = $state<{ title: string; description: string } | null>(null);
let noticeOpen = $state(false);

async function upload(files: FileList | File[]) {
  const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
  if (list.length === 0) return;
  const fd = new FormData();
  for (const f of list) fd.append("files", f);
  uploading = list.length;
  let res: { uploaded: { deduplicated: boolean }[] } | undefined;
  try {
    res = await api<{ uploaded: { deduplicated: boolean }[] }>(`/blocks/${blockId}/photos`, {
      method: "POST",
      body: fd,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 413) {
      // The server stops at the first photo over the limit; earlier ones are kept.
      notice = {
        title: e.message.toLowerCase().includes("quota") ? "Storage full" : "Photo too large",
        description: `${e.message} Photos before this one in the selection were saved.`,
      };
      noticeOpen = true;
    } else {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    }
    return;
  } finally {
    uploading = 0;
  }
  const dups = res.uploaded.filter((u) => u.deduplicated).length;
  toast.success(
    `Uploaded ${res.uploaded.length} photo${res.uploaded.length === 1 ? "" : "s"}` +
      (dups ? ` (${dups} already stored, reused)` : ""),
  );
}

async function saveCaption(p: Photo, raw: string) {
  const caption = raw.trim() === "" ? null : raw.trim();
  if (caption === (p.caption ?? null)) return;
  await attempt(() => patch(`/photos/${p.id}`, { caption }));
}

/**
 * Drop the dragged photo (from this or another gallery) before or after
 * `target`, or at the end of this gallery. One write either way.
 */
async function drop(target: Photo | null) {
  const dragged = photoDrag.current;
  const after = dropTarget?.after ?? false;
  endDrag();
  if (!dragged || dragged.id === target?.id) return;
  let beforeId: string | null = null;
  if (target) {
    const rest = photos.filter((p) => p.id !== dragged.id);
    beforeId = after
      ? (rest[rest.findIndex((p) => p.id === target.id) + 1]?.id ?? null)
      : target.id;
  }
  await attempt(() => post(`/photos/${dragged.id}/move`, { blockId, beforeId }));
}

function endDrag() {
  photoDrag.current = null;
  dropTarget = null;
  over = false;
}

/** A photo from another gallery is being dragged over this one. */
const draggingForeign = $derived(
  photoDrag.current !== null && photoDrag.current.blockId !== blockId,
);
</script>

{#if photos.length > 0}
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
    {#each photos as p (p.id)}
      <div
        role="listitem"
        class={cn(
					'relative transition-opacity',
					photoDrag.current?.id === p.id && 'opacity-40',
					dropTarget?.id === p.id &&
						(dropTarget.after ? 'border-r-4 border-r-primary' : 'border-l-4 border-l-primary')
				)}
        ondragover={(e) => {
					if (!photoDrag.current || photoDrag.current.id === p.id) return;
					e.preventDefault();
					const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
					dropTarget = { id: p.id, after: e.clientX > rect.left + rect.width / 2 };
				}}
        ondrop={(e) => {
					e.preventDefault();
					void drop(p);
				}}
      >
        <div
          role="img"
          aria-label={p.caption ?? 'Photo'}
          class="group relative aspect-square cursor-grab overflow-hidden rounded-lg bg-muted"
          draggable="true"
          ondragstart={() => (photoDrag.current = { id: p.id, blockId })}
          ondragend={endDrag}
        >
          <img
            src={imageSrc(p.filename, 400)}
            alt={p.caption ?? ''}
            class="size-full object-cover"
            draggable="false"
          >
          <Button
            variant="secondary"
            size="icon-xs"
            class="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label="Delete photo"
            onclick={() => {
							deleteTarget = p;
							deleteOpen = true;
						}}
          >
            <X />
          </Button>
        </div>
        <Input
          class="mt-1 h-8 text-xs"
          placeholder="Caption…"
          value={p.caption ?? ''}
          onchange={(e) => saveCaption(p, e.currentTarget.value)}
        />
      </div>
    {/each}
  </div>
{/if}

<button
  type="button"
  class={cn(
		'mt-3 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground transition-colors',
		over ? 'border-primary bg-muted' : 'hover:bg-muted/50'
	)}
  ondragover={(e) => {
		if (photoDrag.current && !draggingForeign) return;
		e.preventDefault();
		over = true;
	}}
  ondragleave={() => (over = false)}
  ondrop={(e) => {
		e.preventDefault();
		if (photoDrag.current) {
			if (draggingForeign) void drop(null);
			return;
		}
		over = false;
		if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files);
	}}
  onclick={() => input?.click()}
  disabled={uploading > 0}
>
  <ImagePlus class="size-5" />
  {uploading > 0
		? `Uploading ${uploading} photo${uploading === 1 ? '' : 's'}…`
		: draggingForeign
			? 'Drop to move the photo into this gallery'
			: 'Drop photos here or click to choose'}
</button>
<input
  bind:this={input}
  type="file"
  accept="image/*"
  multiple
  class="hidden"
  onchange={(e) => {
		const files = e.currentTarget.files;
		if (files) void upload(files);
		e.currentTarget.value = '';
	}}
>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Delete this photo?"
  description="The file is removed from disk unless another gallery uses the same image."
  onconfirm={() => deleteTarget && attempt(() => del(`/photos/${deleteTarget?.id}`))}
/>

<NoticeDialog
  bind:open={noticeOpen}
  title={notice?.title ?? ''}
  description={notice?.description}
/>
