<script lang="ts">
import type { Photo, Section, SharedView } from "@sammelband/shared";
import { invalidateAll } from "$app/navigation";
import { post } from "$lib/api";
import AlbumContent from "$lib/components/album/album-content.svelte";
import AlbumCard from "$lib/components/library/album-card.svelte";
import FolderCard from "$lib/components/library/folder-card.svelte";
import * as Alert from "$lib/components/ui/alert";
import * as Breadcrumb from "$lib/components/ui/breadcrumb";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { errorText } from "$lib/i18n";
import { m } from "$lib/paraglide/messages.js";
import { sharePath } from "$lib/public";

/** A public link page: password prompt, shared folder or shared album. */
let { token, view }: { token: string; view: SharedView } = $props();

let password = $state("");
let busy = $state(false);
let problem = $state<string | null>(null);

async function unlock(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  problem = null;
  try {
    await post(`/public/${token}/unlock`, { password });
    await invalidateAll();
  } catch (err) {
    problem = errorText(err);
  } finally {
    busy = false;
  }
}

const title = $derived(
  view.status !== "ok"
    ? m.public_shared_with_you()
    : view.kind === "album"
      ? view.album.title
      : view.folder.name,
);
// Breadcrumb inside a folder link: everything but the current folder links back.
const crumbs = $derived(
  view.status === "ok" ? (view.kind === "folder" ? view.trail.slice(0, -1) : view.trail) : [],
);
const crumbHref = (i: number, id: string) =>
  i === 0 ? sharePath(token) : sharePath(token, `/folders/${id}`);
</script>

<svelte:head><title>{title} · Sammelband</title></svelte:head>

{#if view.status === 'locked'}
  <div class="mx-auto mt-12 max-w-sm">
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.public_password_required()}</Card.Title>
        <Card.Description>{m.public_password_hint()}</Card.Description>
      </Card.Header>
      <Card.Content>
        <form class="grid gap-4" onsubmit={unlock}>
          {#if problem}
            <Alert.Root variant="destructive"
              ><Alert.Description>{problem}</Alert.Description></Alert.Root
            >
          {/if}
          <div class="grid gap-2">
            <Label for="share-password">{m.common_password()}</Label>
            <Input
              id="share-password"
              type="password"
              bind:value={password}
              required
              autocomplete="off"
            />
          </div>
          <Button type="submit" disabled={busy}>{m.public_open()}</Button>
        </form>
      </Card.Content>
    </Card.Root>
  </div>
{:else}
  {#if crumbs.length > 0}
    <Breadcrumb.Root class="mb-3">
      <Breadcrumb.List>
        {#each crumbs as c, i (c.id)}
          {#if i > 0}
            <Breadcrumb.Separator />
          {/if}
          <Breadcrumb.Item
            ><Breadcrumb.Link href={crumbHref(i, c.id)}>{c.name}</Breadcrumb.Link></Breadcrumb.Item
          >
        {/each}
      </Breadcrumb.List>
    </Breadcrumb.Root>
  {/if}

  {#if view.kind === 'album'}
    <article class="mx-auto max-w-4xl">
      <h1 class="font-heading text-4xl leading-tight sm:text-5xl">{view.album.title}</h1>
      {#if view.album.description}
        <p class="mt-4 max-w-2xl text-lg text-muted-foreground">{view.album.description}</p>
      {/if}
      <div class="mt-10">
        <!-- Public rows carry only what rendering needs. -->
        <AlbumContent sections={view.sections as Section[]} photos={view.photos as Photo[]} />
      </div>
    </article>
  {:else}
    <h1 class="mb-10 font-heading text-4xl">{view.folder.name}</h1>
    {#if view.folders.length > 0}
      <div class="mb-12 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {#each view.folders as f (f.id)}
          <FolderCard folder={f} href={sharePath(token, `/folders/${f.id}`)} />
        {/each}
      </div>
    {/if}
    {#if view.albums.length === 0 && view.folders.length === 0}
      <div class="rounded-2xl border border-dashed px-6 py-16 text-center text-muted-foreground">
        {m.public_empty()}
      </div>
    {/if}
    <div class="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {#each view.albums as album (album.id)}
        <AlbumCard {album} href={sharePath(token, `/albums/${album.short_id}`)} />
      {/each}
    </div>
  {/if}
{/if}
