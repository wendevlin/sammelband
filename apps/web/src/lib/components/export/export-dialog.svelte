<script lang="ts">
import BookOpen from "@lucide/svelte/icons/book-open";
import Download from "@lucide/svelte/icons/download";
import Monitor from "@lucide/svelte/icons/monitor";
import Printer from "@lucide/svelte/icons/printer";
import { type AlbumExport, type ExportPurpose, sheetCount } from "@sammelband/shared";
import { type AlbumExports, exportUrl } from "#lib/album-exports.svelte.ts";
import { post } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import * as Dialog from "#lib/components/ui/dialog/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import { Switch } from "#lib/components/ui/switch/index.ts";
import type { ExportProfiles } from "#lib/export-profiles.svelte.ts";
import { errorCodeText } from "#lib/i18n.ts";
import { m } from "#lib/paraglide/messages.js";
import { cn } from "#lib/utils.ts";
import ExportWarnings from "./export-warnings.svelte";
import { previewSize, profileLabel, profileSummary, purposeLabel } from "./format-label";

/**
 * Export an album as PDF: pick what it's for, the print profile (page format,
 * or a print service's) and captions, then follow the progress. The PDF is
 * made in the background, so the dialog can be closed at any time; the
 * export stays in the album's list of exports. Only the profiles the admins
 * switched on are offered; the last one used is remembered on this device.
 */
let {
  open = $bindable(false),
  albumId,
  exports,
  profiles,
  onshowall,
}: {
  open?: boolean;
  albumId: string;
  exports: AlbumExports;
  /** The print profiles that can be used (kept current by the album page). */
  profiles: ExportProfiles;
  onshowall: () => void;
} = $props();

/** What the PDF is for: decides margins or edge to edge, bleed and resolution. */
const PURPOSE_CHOICES = [
  { id: "print", icon: BookOpen, hint: m.export_purpose_print_hint },
  { id: "home", icon: Printer, hint: m.export_purpose_home_hint },
  { id: "screen", icon: Monitor, hint: m.export_purpose_screen_hint },
] as const;

const LAST_PROFILE = "sammelband:export-profile";
let purpose = $state<ExportPurpose>("print");
let profileId = $state<string | null>(null);
let captions = $state(true);
let albumLink = $state(false);
let busy = $state(false);
/** The export started from this dialog; the dialog then shows its progress. */
let startedId = $state<string | null>(null);
const started = $derived(exports.get(startedId));

/** Purposes with at least one profile switched on, in the order they are offered. */
const purposes = $derived(
  PURPOSE_CHOICES.map((p) => p.id).filter((p) => profiles.list.some((x) => x.spec.purpose === p)),
);
const choices = $derived(profiles.list.filter((x) => x.spec.purpose === purpose));
const profile = $derived(profiles.list.find((x) => x.id === profileId));

$effect(() => {
  // A fresh dialog each time it opens.
  if (open) startedId = null;
});

// Start with the last profile used, else the first of the first purpose; and
// keep the choice valid when the admins switch profiles off.
$effect(() => {
  const list = profiles.list;
  if (list.length === 0 || list.some((x) => x.id === profileId)) return;
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_PROFILE);
  } catch {
    // No storage: start with the first one.
  }
  const chosen =
    list.find((x) => x.id === last) ?? list.find((x) => x.spec.purpose === purposes[0]) ?? list[0];
  if (!chosen) return;
  profileId = chosen.id;
  purpose = chosen.spec.purpose;
});

function choosePurpose(p: ExportPurpose) {
  purpose = p;
  if (profile?.spec.purpose !== p) profileId = choices[0]?.id ?? null;
}

async function start() {
  if (!profileId) return;
  busy = true;
  const created = await attempt(() =>
    post<AlbumExport>(`/albums/${albumId}/exports`, {
      profileId,
      captions,
      // The QR code goes on the back: profiles without a cover have none.
      albumLink: albumLink && profile?.spec.cover.mode !== "none",
    }),
  );
  busy = false;
  if (!created) return;
  try {
    localStorage.setItem(LAST_PROFILE, created.profile.id);
  } catch {
    // Not remembered, then.
  }
  exports.upsert(created);
  startedId = created.id;
}

/** "26 pages", and with spreads "· 13 PDF pages". */
function pagesText(x: AlbumExport): string {
  if (!x.page_count) return "";
  const pages =
    x.page_count === 1
      ? m.export_pages_one({ count: x.page_count })
      : m.export_pages_other({ count: x.page_count });
  if (x.profile.spec.layout !== "spread") return pages;
  return `${pages} · ${m.export_sheets({ count: sheetCount(x.profile.spec, x.page_count) })}`;
}

/** Page previews: the profile's page (or spread), at most 40 px high or 48 px wide. */
function preview(spec: (typeof profiles.list)[number]["spec"]) {
  const { width, height } = previewSize(spec);
  return `width:${width}px;height:${height}px`;
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
      {#if profiles.loaded && profiles.list.length === 0}
        <p class="text-sm text-muted-foreground">{m.export_no_profiles()}</p>
      {:else}
        <div class="grid gap-5">
          <fieldset class="grid gap-2">
            <legend class="mb-2 text-sm font-medium">{m.export_purpose()}</legend>
            <div class="grid gap-2">
              {#each PURPOSE_CHOICES.filter((p) => purposes.includes(p.id)) as p (p.id)}
                <button
                  type="button"
                  aria-pressed={purpose === p.id}
                  onclick={() => choosePurpose(p.id)}
                  class={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors",
                    purpose === p.id ? "border-primary bg-accent" : "hover:bg-muted",
                  )}
                >
                  <p.icon
                    class={cn(
                      "mt-0.5 size-5 shrink-0",
                      purpose === p.id ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span>
                    <span class="block font-medium">{purposeLabel(p.id)}</span>
                    <span class="block text-xs text-muted-foreground">{p.hint()}</span>
                  </span>
                </button>
              {/each}
            </div>
          </fieldset>

          <fieldset class="grid gap-2">
            <legend class="mb-2 text-sm font-medium">{m.export_profile()}</legend>
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {#each choices as x (x.id)}
                <button
                  type="button"
                  aria-pressed={profileId === x.id}
                  onclick={() => (profileId = x.id)}
                  class={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-2 pt-3 text-xs transition-colors",
                    profileId === x.id
                      ? "border-primary bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span class="flex h-10 items-end">
                    <span
                      class={cn(
                        "relative block rounded-[2px] border bg-card shadow-xs",
                        profileId === x.id && "border-primary",
                      )}
                      style={preview(x.spec)}
                    >
                      {#if x.spec.layout === "spread"}
                        <span class="absolute inset-y-0 left-1/2 border-l border-dashed"></span>
                      {/if}
                    </span>
                  </span>
                  <span class="text-center leading-tight">{profileLabel(x)}</span>
                </button>
              {/each}
            </div>
            {#if profile}
              <p class="text-xs text-muted-foreground">{profileSummary(profile.spec)}</p>
            {/if}
          </fieldset>

          <div class="flex items-center justify-between gap-4">
            <Label for="export-captions">{m.export_captions()}</Label>
            <Switch id="export-captions" bind:checked={captions} />
          </div>

          <div class="flex items-center justify-between gap-4">
            <div class="grid gap-1">
              <Label for="export-album-link">{m.export_album_link()}</Label>
              <p class="text-xs text-muted-foreground">{m.export_album_link_hint()}</p>
            </div>
            <Switch
              id="export-album-link"
              bind:checked={albumLink}
              disabled={profile?.spec.cover.mode === "none"}
            />
          </div>
        </div>
      {/if}
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (open = false)}>{m.common_cancel()}</Button>
        <Button onclick={start} disabled={busy || !profile}>{m.export_start()}</Button>
      </Dialog.Footer>
    {:else}
      <div class="grid gap-4 py-2" aria-live="polite">
        {#if started.status === "done"}
          <p class="font-medium">{m.export_ready()}</p>
          {#if started.video_link}
            <p class="text-sm text-muted-foreground">{m.export_ready_video_link()}</p>
          {/if}
          {#if started.album_link}
            <p class="text-sm text-muted-foreground">{m.export_ready_album_link()}</p>
          {/if}
          <p class="text-sm text-muted-foreground">
            {profileLabel(started.profile)}
            {#if started.page_count}
              · {pagesText(started)}
            {/if}
          </p>
          <ExportWarnings warnings={started.warnings} />
        {:else if started.status === "failed"}
          <p class="font-medium">{m.export_failed()}</p>
          <p class="text-sm text-muted-foreground">{errorCodeText(started.error_code)}</p>
        {:else}
          <p class="text-sm">
            {started.status === "queued" ? m.export_waiting() : m.export_working()}
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
        {#if started.status === "done" && started.has_cover_file}
          <Button variant="outline" href={exportUrl(started.id, "cover")} download
            ><Download /> {m.export_download_cover()}</Button
          >
          <Button href={exportUrl(started.id)} download onclick={() => (open = false)}
            ><Download /> {m.export_download_pages()}</Button
          >
        {:else if started.status === "done"}
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
