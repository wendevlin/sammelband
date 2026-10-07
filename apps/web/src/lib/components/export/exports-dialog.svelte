<script lang="ts">
import Download from "@lucide/svelte/icons/download";
import FileText from "@lucide/svelte/icons/file-text";
import Pencil from "@lucide/svelte/icons/pencil";
import Trash from "@lucide/svelte/icons/trash-2";
import type { AlbumExport } from "@sammelband/shared";
import { type AlbumExports, exportUrl } from "$lib/album-exports.svelte";
import { del, patch } from "$lib/api";
import { attempt } from "$lib/attempt";
import ConfirmDialog from "$lib/components/dialogs/confirm-dialog.svelte";
import PromptDialog from "$lib/components/dialogs/prompt-dialog.svelte";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { errorCodeText, getLocale } from "$lib/i18n";
import { formatBytes } from "$lib/images";
import { m } from "$lib/paraglide/messages.js";
import { formatLabel, purposeLabel } from "./format-label";

/** An album's PDF exports: download, rename, delete. */
let { open = $bindable(false), exports }: { open?: boolean; exports: AlbumExports } = $props();

let renaming = $state<AlbumExport | null>(null);
let renameOpen = $state(false);
let deleting = $state<AlbumExport | null>(null);
let deleteOpen = $state(false);

const date = (ms: number) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(ms);

function details(x: AlbumExport): string {
  const parts = [formatLabel(x.format), purposeLabel(x.options.purpose), date(x.created_at)];
  if (x.status === "done") {
    if (x.page_count) {
      parts.push(
        x.page_count === 1
          ? m.export_pages_one({ count: x.page_count })
          : m.export_pages_other({ count: x.page_count }),
      );
    }
    if (x.file_size) parts.push(formatBytes(x.file_size));
  }
  return parts.join(" · ");
}

async function rename(name: string) {
  const target = renaming;
  if (!target) return false;
  const updated = await attempt(
    () => patch<AlbumExport>(`/exports/${target.id}`, { name }),
    m.export_renamed(),
  );
  if (updated) exports.upsert(updated);
  return Boolean(updated);
}

async function remove() {
  const target = deleting;
  if (!target) return;
  const ok = await attempt(() => del(`/exports/${target.id}`), m.export_deleted());
  if (ok) exports.list = exports.list.filter((x) => x.id !== target.id);
}
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>{m.exports_title()}</Dialog.Title>
      <Dialog.Description>{m.exports_description()}</Dialog.Description>
    </Dialog.Header>
    <ul class="-mx-2 grid max-h-[60vh] grid-cols-1 gap-1 overflow-y-auto">
      {#each exports.list as x (x.id)}
        <li class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
          <FileText class="size-5 shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{x.name}</p>
            <p class="truncate text-xs text-muted-foreground">
              {details(x)}
              {#if x.status === 'queued'}
                · {m.export_status_queued()}
              {:else if x.status === 'running'}
                · {m.export_status_running({ progress: x.progress })}
              {:else if x.status === 'failed'}
                ·
                <span class="text-destructive"
                  >{m.export_status_failed()}: {errorCodeText(x.error_code)}</span
                >
              {/if}
            </p>
          </div>
          <div class="flex shrink-0 gap-1">
            {#if x.status === 'done'}
              <Button
                variant="ghost"
                size="icon-sm"
                href={exportUrl(x.id)}
                download
                aria-label={m.export_download()}
                title={m.export_download()}
                ><Download /></Button
              >
            {/if}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={m.common_rename()}
              title={m.common_rename()}
              onclick={() => {
                renaming = x;
                renameOpen = true;
              }}
              ><Pencil /></Button
            >
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={m.common_delete()}
              title={m.common_delete()}
              onclick={() => {
                deleting = x;
                deleteOpen = true;
              }}
              ><Trash /></Button
            >
          </div>
        </li>
      {:else}
        <li class="px-2 py-6 text-center text-sm text-muted-foreground">—</li>
      {/each}
    </ul>
  </Dialog.Content>
</Dialog.Root>

<PromptDialog
  bind:open={renameOpen}
  title={m.common_rename()}
  label={m.export_name()}
  value={renaming?.name ?? ''}
  onsubmit={rename}
/>
<ConfirmDialog
  bind:open={deleteOpen}
  title={m.export_delete_confirm({ name: deleting?.name ?? '' })}
  description={m.export_delete_description()}
  onconfirm={remove}
/>
