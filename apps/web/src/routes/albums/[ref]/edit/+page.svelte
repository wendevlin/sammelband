<script lang="ts">
import ArrowLeft from "@lucide/svelte/icons/arrow-left";
import Check from "@lucide/svelte/icons/check";
import Trash from "@lucide/svelte/icons/trash-2";
import type { Folder } from "@sammelband/shared";
import { AlbumExports } from "#lib/album-exports.svelte.ts";
import { getAlbumState } from "#lib/album-state.svelte.ts";
import { del, patch, post } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import SimpleSelect from "#lib/components/app/simple-select.svelte";
import ConfirmDialog from "#lib/components/dialogs/confirm-dialog.svelte";
import SectionEditor from "#lib/components/editor/section-editor.svelte";
import { Button } from "#lib/components/ui/button/index.ts";
import * as Card from "#lib/components/ui/card/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import * as Tabs from "#lib/components/ui/tabs/index.ts";
import { Textarea } from "#lib/components/ui/textarea/index.ts";
import { imageSrc } from "#lib/images.ts";
import { albumPath } from "#lib/links.ts";
import { m } from "#lib/paraglide/messages.js";
import { cn } from "#lib/utils.ts";
import { goto } from "$app/navigation";

let { data } = $props();

// Album, sections and photos come from the layout's live state; `data` still
// carries the folders.
const live = getAlbumState();

// Metadata drafts; refreshed from the server while there are no unsaved edits.
let title = $state("");
let description = $state("");
let folderId = $state("");
let dirty = $state(false);
let saving = $state(false);
let deleteOpen = $state(false);
// Deleting the album deletes its PDF exports too: the confirmation names them.
const exports = new AlbumExports(() => live.album.id);
const deleteDescription = $derived.by(() => {
  const names = exports.list.map((x) => x.name).join(", ");
  const count = exports.list.length;
  if (count === 0) return m.album_delete_description();
  const also =
    count === 1
      ? m.album_delete_exports_one({ names })
      : m.album_delete_exports_other({ count, names });
  return `${m.album_delete_description()} ${also}`;
});

$effect(() => {
  const a = live.album;
  if (dirty) return;
  title = a.title;
  description = a.description ?? "";
  folderId = a.folder_id ?? "";
});

function pathOf(f: Folder): string {
  const names = [f.name];
  let parent = data.folders.find((x) => x.id === f.parent_id);
  while (parent) {
    names.unshift(parent.name);
    const next: string | null = parent.parent_id;
    parent = data.folders.find((x) => x.id === next);
  }
  return names.join(" / ");
}

const folderOptions = $derived([
  { value: "", label: m.album_no_folder() },
  ...data.folders
    .map((f) => ({ value: f.id, label: pathOf(f) }))
    .sort((a, b) => a.label.localeCompare(b.label)),
]);

async function saveMeta(e?: SubmitEvent) {
  e?.preventDefault();
  saving = true;
  const ok = await attempt(
    () =>
      patch(`/albums/${live.album.id}`, {
        title: title.trim(),
        description: description.trim() || null,
        folderId: folderId || null,
      }),
    m.common_saved(),
  );
  saving = false;
  if (ok) dirty = false;
}

const setCover = (photoId: string | null) =>
  attempt(() => post(`/albums/${live.album.id}/cover`, { photoId }));

async function deleteAlbum() {
  const ok = await attempt(() => del(`/albums/${live.album.id}`), m.album_deleted());
  if (ok) await goto(live.album.folder_id ? `/folders/${live.album.folder_id}` : "/");
}
</script>

<svelte:head><title>{m.album_edit()}: {live.album.title} · Sammelband</title></svelte:head>

<div class="mb-6 flex flex-wrap items-center justify-between gap-2">
  <Button variant="ghost" href={albumPath(live.album)}><ArrowLeft /> {m.album_view()}</Button>
  <Button variant="destructive" onclick={() => (deleteOpen = true)}
    ><Trash /> {m.album_delete()}</Button
  >
</div>

<Card.Root class="mb-8">
  <Card.Content>
    <form class="grid gap-4" onsubmit={saveMeta} oninput={() => (dirty = true)}>
      <div class="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div class="grid gap-2">
          <Label for="title">{m.common_title()}</Label>
          <Input id="title" bind:value={title} required maxlength={200} />
        </div>
        <div class="grid gap-2">
          <Label>{m.folder_badge()}</Label>
          <SimpleSelect
            label={m.folder_badge()}
            value={folderId}
            options={folderOptions}
            onchange={(v) => {
              folderId = v;
              dirty = true;
            }}
            class="w-64"
          />
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="description">{m.album_description()}</Label>
        <Textarea
          id="description"
          bind:value={description}
          rows={2}
          placeholder={m.common_optional()}
        />
      </div>
      {#if dirty}
        <div class="flex justify-end gap-2">
          <Button variant="outline" onclick={() => (dirty = false)}>{m.common_discard()}</Button>
          <Button type="submit" disabled={saving || !title.trim()}>{m.common_save()}</Button>
        </div>
      {/if}
    </form>
  </Card.Content>
</Card.Root>

<Tabs.Root value="content">
  <Tabs.List class="mb-6">
    <Tabs.Trigger value="content">{m.album_tab_content()}</Tabs.Trigger>
    <Tabs.Trigger value="cover">{m.album_tab_cover()}</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="content">
    <SectionEditor albumId={live.album.id} sections={live.sections} photos={live.photos} />
  </Tabs.Content>
  <Tabs.Content value="cover">
    <p class="mb-4 text-sm text-muted-foreground">
      {m.album_cover_hint()}
    </p>
    {#if live.photos.length === 0}
      <p class="rounded-2xl border border-dashed px-6 py-10 text-center text-muted-foreground">
        {m.album_cover_no_photos()}
      </p>
    {:else}
      <Button
        variant={live.album.cover_photo_id ? "outline" : "default"}
        size="sm"
        class="mb-4"
        onclick={() => setCover(null)}
      >
        {#if !live.album.cover_photo_id}
          <Check />
        {/if}
        {m.album_cover_automatic()}
      </Button>
      <div class="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8">
        {#each live.photos as p (p.id)}
          <button
            type="button"
            class={cn(
              "relative aspect-square overflow-hidden rounded-lg bg-muted outline-offset-2",
              live.album.cover_photo_id === p.id && "outline-3 outline-primary",
            )}
            onclick={() => setCover(p.id)}
            aria-label={m.album_cover_use()}
          >
            <img
              src={imageSrc(p.filename, 400)}
              alt={p.caption ?? ""}
              class="size-full object-cover"
            >
          </button>
        {/each}
      </div>
    {/if}
  </Tabs.Content>
</Tabs.Root>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.folder_delete_confirm({ name: live.album.title })}
  description={deleteDescription}
  onconfirm={deleteAlbum}
/>
