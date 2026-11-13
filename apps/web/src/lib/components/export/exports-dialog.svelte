<script lang="ts">
import BookImage from "@lucide/svelte/icons/book-image";
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import FileText from "@lucide/svelte/icons/file-text";
import Pencil from "@lucide/svelte/icons/pencil";
import QrCode from "@lucide/svelte/icons/qr-code";
import Trash from "@lucide/svelte/icons/trash-2";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import { type AlbumExport, sheetCount } from "@sammelband/shared";
import { type AlbumExports, exportUrl, isOutdated } from "#lib/album-exports.svelte.ts";
import { del, patch } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import ConfirmDialog from "#lib/components/dialogs/confirm-dialog.svelte";
import PromptDialog from "#lib/components/dialogs/prompt-dialog.svelte";
import * as AlertDialog from "#lib/components/ui/alert-dialog/index.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import * as Dialog from "#lib/components/ui/dialog/index.ts";
import { errorCodeText, getLocale } from "#lib/i18n.ts";
import { formatBytes } from "#lib/images.ts";
import { m } from "#lib/paraglide/messages.js";
import ExportWarnings from "./export-warnings.svelte";
import { profileLabel, purposeLabel } from "./format-label";

/**
 * An album's PDF exports: download, rename, delete. Exports the album has
 * changed since are marked as outdated. A PDF with videos has a video link
 * (its QR codes lead there), one with the album link option a link to the
 * album (the QR code on its back); deleting the PDF asks whether to keep
 * them, so printed copies keep working.
 */
let {
  open = $bindable(false),
  exports,
  albumUpdatedAt,
}: { open?: boolean; exports: AlbumExports; albumUpdatedAt: number } = $props();

let renaming = $state<AlbumExport | null>(null);
let renameOpen = $state(false);
let deleting = $state<AlbumExport | null>(null);
let deleteOpen = $state(false);

const date = (ms: number) =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: "medium", timeStyle: "short" }).format(ms);

function details(x: AlbumExport): string {
  const parts = [profileLabel(x.profile), purposeLabel(x.profile.spec.purpose), date(x.created_at)];
  if (x.status === "done") {
    if (x.page_count) {
      parts.push(
        x.page_count === 1
          ? m.export_pages_one({ count: x.page_count })
          : m.export_pages_other({ count: x.page_count }),
      );
      if (x.profile.spec.layout === "spread") {
        parts.push(m.export_sheets({ count: sheetCount(x.profile.spec, x.page_count) }));
      }
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

/** How many links a PDF has (video link, album link). */
const linkCount = (x: AlbumExport | null) => (x?.video_link ? 1 : 0) + (x?.album_link ? 1 : 0);

async function remove(keepLinks = false) {
  const target = deleting;
  if (!target) return;
  busy = true;
  const kept =
    linkCount(target) === 1 ? m.export_deleted_link_kept_one() : m.export_deleted_link_kept_other();
  const ok = await attempt(
    () => del(`/exports/${target.id}?keepLinks=${keepLinks}`),
    keepLinks ? kept : m.export_deleted(),
  );
  busy = false;
  deleteOpen = false;
  if (ok) exports.list = exports.list.filter((x) => x.id !== target.id);
}

let busy = $state(false);
let copied = $state<string | null>(null);

async function copyLink(link: { id: string; url: string }) {
  await navigator.clipboard.writeText(link.url).catch(() => {});
  copied = link.id;
  setTimeout(() => (copied = null), 2000);
}

/** The links of a PDF, with what each is for. */
function linksOf(x: AlbumExport) {
  const links: { id: string; url: string; label: string }[] = [];
  if (x.video_link) links.push({ ...x.video_link, label: m.export_video_link() });
  if (x.album_link) links.push({ ...x.album_link, label: m.export_album_link_row() });
  return links;
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
              {#if x.status === "queued"}
                · {m.export_status_queued()}
              {:else if x.status === "running"}
                · {m.export_status_running({ progress: x.progress })}
              {:else if x.status === "failed"}
                ·
                <span class="text-destructive"
                  >{m.export_status_failed()}: {errorCodeText(x.error_code)}</span
                >
              {/if}
            </p>
            {#if isOutdated(x, albumUpdatedAt)}
              <p class="mt-0.5 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlert class="mt-px size-3.5 shrink-0" />
                {m.export_outdated({ date: date(x.created_at) })}
              </p>
            {/if}
            {#if x.status === "done"}
              <div class="mt-0.5 text-xs">
                <ExportWarnings warnings={x.warnings} />
              </div>
            {/if}
            {#each linksOf(x) as link (link.id)}
              <p class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <QrCode class="size-3.5 shrink-0" />
                <span class="truncate">{link.label}</span>
                <button
                  type="button"
                  class="ml-0.5 inline-flex shrink-0 items-center gap-1 rounded px-1 text-primary hover:underline"
                  onclick={() => copyLink(link)}
                >
                  {#if copied === link.id}
                    <Check class="size-3" />
                    {m.common_copied()}
                  {:else}
                    <Copy class="size-3" />
                    {m.common_copy_link()}
                  {/if}
                </button>
              </p>
            {/each}
          </div>
          <div class="flex shrink-0 gap-1">
            {#if x.status === "done" && x.has_cover_file}
              <Button
                variant="ghost"
                size="icon-sm"
                href={exportUrl(x.id, "cover")}
                download
                aria-label={m.export_download_cover()}
                title={m.export_download_cover()}
                ><BookImage /></Button
              >
            {/if}
            {#if x.status === "done"}
              <Button
                variant="ghost"
                size="icon-sm"
                href={exportUrl(x.id)}
                download
                aria-label={x.has_cover_file ? m.export_download_pages() : m.export_download()}
                title={x.has_cover_file ? m.export_download_pages() : m.export_download()}
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
  value={renaming?.name ?? ""}
  onsubmit={rename}
/>
{#if linkCount(deleting) > 0}
  <AlertDialog.Root bind:open={deleteOpen}>
    <!-- Wider than a plain confirmation: three choices. -->
    <AlertDialog.Content class="data-[size=default]:sm:max-w-2xl">
      <AlertDialog.Header>
        <AlertDialog.Title
          >{m.export_delete_confirm({ name: deleting?.name ?? "" })}</AlertDialog.Title
        >
        <AlertDialog.Description>{m.export_delete_with_link_description()}</AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer class="sm:flex-wrap">
        <AlertDialog.Cancel>{m.common_cancel()}</AlertDialog.Cancel>
        <Button variant="outline" disabled={busy} onclick={() => remove(true)}>
          {linkCount(deleting) === 1
            ? m.export_delete_keep_link_one()
            : m.export_delete_keep_link_other()}
        </Button>
        <Button variant="destructive" disabled={busy} onclick={() => remove(false)}>
          {m.export_delete_with_link()}
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>
{:else}
  <ConfirmDialog
    bind:open={deleteOpen}
    title={m.export_delete_confirm({ name: deleting?.name ?? "" })}
    description={m.export_delete_description()}
    onconfirm={() => remove()}
  />
{/if}
