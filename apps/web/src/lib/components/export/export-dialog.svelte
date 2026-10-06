<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Download from "@lucide/svelte/icons/download";
import {
  type AlbumExport,
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportQuality,
  PAGE_FORMATS,
} from "@sammelband/shared";
import { type AlbumExports, exportUrl } from "$lib/album-exports.svelte";
import { post } from "$lib/api";
import { attempt } from "$lib/attempt";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { Label } from "$lib/components/ui/label";
import { Switch } from "$lib/components/ui/switch";
import { errorCodeText } from "$lib/i18n";
import { m } from "$lib/paraglide/messages.js";
import { cn } from "$lib/utils";
import { formatLabel } from "./format-label";

/**
 * Export an album as PDF: pick the page format, quality and captions, then
 * follow the progress. The PDF is made in the background, so the dialog can
 * be closed at any time; the export stays in the album's list of exports.
 */
let {
  open = $bindable(false),
  albumId,
  exports,
  onshowall,
}: {
  open?: boolean;
  albumId: string;
  exports: AlbumExports;
  onshowall: () => void;
} = $props();

let format = $state<ExportFormat>("a4");
let quality = $state<ExportQuality>("print");
let captions = $state(true);
let busy = $state(false);
/** The export started from this dialog; the dialog then shows its progress. */
let startedId = $state<string | null>(null);
const started = $derived(exports.get(startedId));

$effect(() => {
  // A fresh dialog each time it opens.
  if (open) startedId = null;
});

async function start() {
  busy = true;
  const created = await attempt(() =>
    post<AlbumExport>(`/albums/${albumId}/exports`, { format, quality, captions }),
  );
  busy = false;
  if (!created) return;
  exports.upsert(created);
  startedId = created.id;
}

/** Page previews: the formats' proportions, at most 40 px high or 48 px wide. */
function preview(f: ExportFormat) {
  const { width, height } = PAGE_FORMATS[f];
  const k = Math.min(40 / height, 48 / width);
  return `width:${Math.round(width * k)}px;height:${Math.round(height * k)}px`;
}
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m.export_pdf()}</Dialog.Title>
      {#if !started}
        <Dialog.Description>{m.export_description()}</Dialog.Description>
      {/if}
    </Dialog.Header>

    {#if !started}
      <div class="grid gap-5">
        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">{m.export_format()}</legend>
          <div class="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {#each EXPORT_FORMATS as f (f)}
              <button
                type="button"
                aria-pressed={format === f}
                onclick={() => (format = f)}
                class={cn(
                  'flex flex-col items-center gap-2 rounded-lg border p-2 pt-3 text-xs transition-colors',
                  format === f
                    ? 'border-primary bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <span class="flex h-10 items-end">
                  <span
                    class={cn(
                      'block rounded-[2px] border bg-card shadow-xs',
                      format === f && 'border-primary',
                    )}
                    style={preview(f)}
                  ></span>
                </span>
                <span class="text-center leading-tight">{formatLabel(f)}</span>
              </button>
            {/each}
          </div>
        </fieldset>

        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">{m.export_quality()}</legend>
          <div class="grid gap-2 sm:grid-cols-2">
            {#each [{ id: 'print', label: m.export_quality_print(), hint: m.export_quality_print_hint() }, { id: 'screen', label: m.export_quality_screen(), hint: m.export_quality_screen_hint() }] as q (q.id)}
              <button
                type="button"
                aria-pressed={quality === q.id}
                onclick={() => (quality = q.id as ExportQuality)}
                class={cn(
                  'flex items-start gap-2 rounded-lg border p-3 text-left text-sm transition-colors',
                  quality === q.id ? 'border-primary bg-accent' : 'hover:bg-muted',
                )}
              >
                <Check
                  class={cn('mt-0.5 size-4 shrink-0 text-primary', quality !== q.id && 'invisible')}
                />
                <span>
                  <span class="block font-medium">{q.label}</span>
                  <span class="block text-xs text-muted-foreground">{q.hint}</span>
                </span>
              </button>
            {/each}
          </div>
        </fieldset>

        <div class="flex items-center justify-between gap-4">
          <Label for="export-captions">{m.export_captions()}</Label>
          <Switch id="export-captions" bind:checked={captions} />
        </div>
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (open = false)}>{m.common_cancel()}</Button>
        <Button onclick={start} disabled={busy}>{m.export_start()}</Button>
      </Dialog.Footer>
    {:else}
      <div class="grid gap-4 py-2" aria-live="polite">
        {#if started.status === 'done'}
          <p class="font-medium">{m.export_ready()}</p>
          <p class="text-sm text-muted-foreground">
            {formatLabel(started.format)}
            {#if started.page_count}
              ·
              {started.page_count === 1
                ? m.export_pages_one({ count: started.page_count })
                : m.export_pages_other({ count: started.page_count })}
            {/if}
          </p>
        {:else if started.status === 'failed'}
          <p class="font-medium">{m.export_failed()}</p>
          <p class="text-sm text-muted-foreground">{errorCodeText(started.error_code)}</p>
        {:else}
          <p class="text-sm">
            {started.status === 'queued' ? m.export_waiting() : m.export_working()}
          </p>
          <div
            class="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={started.progress}
          >
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-500"
              style:width="{Math.max(3, started.progress)}%"
            ></div>
          </div>
          <p class="text-sm text-muted-foreground">{m.export_close_note()}</p>
        {/if}
      </div>
      <Dialog.Footer>
        <Button
          variant="outline"
          onclick={() => {
            open = false;
            onshowall();
          }}
          >{m.export_show_all()}</Button
        >
        {#if started.status === 'done'}
          <Button href={exportUrl(started.id)} download onclick={() => (open = false)}
            ><Download /> {m.export_download()}</Button
          >
        {:else}
          <Button onclick={() => (open = false)}>{m.common_close()}</Button>
        {/if}
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
