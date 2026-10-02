<script lang="ts">
import type { SourceSettingsInfo } from "@sammelband/shared";
import { invalidate } from "$app/navigation";
import { api } from "$lib/api";
import { attempt } from "$lib/attempt";
import SourceIcon from "$lib/components/app/source-icon.svelte";
import { Button } from "$lib/components/ui/button";
import * as Card from "$lib/components/ui/card";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { Switch } from "$lib/components/ui/switch";
import { m } from "$lib/paraglide/messages.js";
import { sources as userSources } from "$lib/stores/sources.svelte";

/**
 * Photo sources of the admin's Sammelband: switched on, optionally with a
 * default server. People connect their own accounts in their profile, there
 * or on other servers.
 */
let { data } = $props();

// Form drafts per source, refreshed when the data reloads.
let drafts = $state<Record<string, { enabled: boolean; url: string }>>({});
$effect(() => {
  drafts = Object.fromEntries(
    data.sources.map((s) => [s.id, { enabled: s.enabled, url: s.config.url ?? "" }]),
  );
});
let saving = $state<string | null>(null);

async function save(s: SourceSettingsInfo, e?: SubmitEvent) {
  e?.preventDefault();
  const draft = drafts[s.id];
  if (!draft) return;
  saving = s.id;
  const ok = await attempt(
    () =>
      api(`/admin/sources/${s.id}`, {
        method: "PUT",
        body: { enabled: draft.enabled, config: draft.enabled ? { url: draft.url } : {} },
      }),
    m.admin_source_saved({ source: s.name }),
  );
  saving = null;
  // Keeps what was typed, so a wrong address can be corrected.
  if (!ok) {
    draft.enabled = s.enabled;
    return;
  }
  await invalidate("app:sources");
  void userSources.load(true);
}
</script>

<svelte:head
  ><title>{m.admin_tab_sources()} · {m.nav_admin_settings()} · Sammelband</title></svelte:head
>

<div class="grid max-w-2xl gap-6">
  <p class="text-muted-foreground">{m.admin_sources_description()}</p>
  {#each data.sources as s (s.id)}
    {@render source(s)}
  {/each}
</div>

{#snippet source(s: SourceSettingsInfo)}
  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        <SourceIcon id={s.id} class="size-5 text-muted-foreground" />
        {s.name}
      </Card.Title>
      <Card.Description>
        {s.accounts === 1
          ? m.admin_source_accounts_one()
          : m.admin_source_accounts_other({ count: s.accounts })}
      </Card.Description>
    </Card.Header>
    {#if drafts[s.id]}
      <Card.Content>
        <form class="grid gap-4" onsubmit={(e) => save(s, e)}>
          <div class="flex items-center gap-3 text-sm">
            <Switch
              id="source-on-{s.id}"
              checked={drafts[s.id]?.enabled ?? false}
              onCheckedChange={(on) => {
                const draft = drafts[s.id];
                if (!draft) return;
                draft.enabled = on;
                void save(s);
              }}
              disabled={saving === s.id}
            />
            <label for="source-on-{s.id}">{m.admin_source_enabled()}</label>
          </div>
          {#if drafts[s.id]?.enabled}
            <div class="grid gap-2">
              <Label for="source-url-{s.id}">{m.admin_nextcloud_url()}</Label>
              <div class="flex flex-wrap gap-2">
                <Input
                  id="source-url-{s.id}"
                  type="url"
                  class="min-w-64 flex-1"
                  placeholder="https://cloud.example.com"
                  value={drafts[s.id]?.url ?? ''}
                  oninput={(e) => {
                    const draft = drafts[s.id];
                    if (draft) draft.url = e.currentTarget.value;
                  }}
                />
                <Button type="submit" disabled={saving === s.id}>{m.common_save()}</Button>
              </div>
              <p class="text-sm text-muted-foreground">{m.admin_nextcloud_url_hint()}</p>
            </div>
          {/if}
        </form>
      </Card.Content>
    {/if}
  </Card.Root>
{/snippet}
