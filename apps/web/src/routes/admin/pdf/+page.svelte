<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import Pencil from "@lucide/svelte/icons/pencil";
import Plus from "@lucide/svelte/icons/plus";
import Trash from "@lucide/svelte/icons/trash-2";
import {
  EXPORT_PURPOSES,
  type ExportProfile,
  type ExportProfileSpec,
  type ExportPurpose,
  type TenantInfo,
} from "@sammelband/shared";
import { api, del } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import ConfirmDialog from "#lib/components/dialogs/confirm-dialog.svelte";
import { profileLabel, profileSummary, purposeLabel } from "#lib/components/export/format-label.ts";
import ProfileDialog from "#lib/components/export/profile-dialog.svelte";
import { Badge } from "#lib/components/ui/badge/index.ts";
import { Button } from "#lib/components/ui/button/index.ts";
import * as Card from "#lib/components/ui/card/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import { Switch } from "#lib/components/ui/switch/index.ts";
import { live } from "#lib/live.svelte.ts";
import { m } from "#lib/paraglide/messages.js";
import { auth } from "#lib/stores/auth.svelte.ts";
import { invalidate } from "$app/navigation";

/**
 * PDF export of the admin's Sammelband: switched on or off, and with which
 * print profiles. Built-in ones can be switched off (one by one or a whole
 * purpose) and duplicated to adjust; own ones edited and deleted.
 */
let { data } = $props();

live(
  () => ["export-profiles"],
  () => "app:export-profiles",
);

// The switch for the whole PDF export.
let pdfExport = $state(auth.tenant?.pdf_export_enabled ?? false);
let savingPdfExport = $state(false);
async function savePdfExport(enabled: boolean) {
  savingPdfExport = true;
  const updated = await attempt(
    () => api<TenantInfo>("/tenant", { method: "PATCH", body: { pdfExportEnabled: enabled } }),
    enabled ? m.general_pdf_export_on() : m.general_pdf_export_off(),
  );
  if (updated) auth.tenant = updated;
  else pdfExport = !enabled;
  savingPdfExport = false;
}

const byPurpose = (p: ExportPurpose) => data.profiles.filter((x) => x.spec.purpose === p);
const purposeOn = (p: ExportPurpose) => byPurpose(p).some((x) => x.enabled);

let busy = $state(false);
async function toggle(x: ExportProfile, enabled: boolean) {
  busy = true;
  await attempt(() =>
    api(`/admin/export-profiles/${encodeURIComponent(x.id)}/enabled`, {
      method: "PUT",
      body: { enabled },
    }),
  );
  await invalidate("app:export-profiles");
  busy = false;
}

async function togglePurpose(p: ExportPurpose, enabled: boolean) {
  busy = true;
  await attempt(() =>
    api(`/admin/export-profiles/purposes/${p}/enabled`, { method: "PUT", body: { enabled } }),
  );
  await invalidate("app:export-profiles");
  busy = false;
}

// The profile dialog: a new profile, a copy, or an own one to edit.
let dialogOpen = $state(false);
let editing = $state<{ id: string | null; name: string; spec: ExportProfileSpec } | null>(null);

function edit(x: ExportProfile) {
  editing = { id: x.id, name: x.name ?? "", spec: x.spec };
  dialogOpen = true;
}

function duplicate(x: ExportProfile) {
  editing = {
    id: null,
    name: m.admin_pdf_profile_copy_name({ name: profileLabel(x) }),
    spec: x.spec,
  };
  dialogOpen = true;
}

function create() {
  const base = data.profiles.find((x) => x.id === "print:a4-landscape") ?? data.profiles[0];
  if (!base) return;
  editing = { id: null, name: "", spec: base.spec };
  dialogOpen = true;
}

let deleting = $state<ExportProfile | null>(null);
let deleteOpen = $state(false);
async function remove() {
  const target = deleting;
  if (!target) return;
  await attempt(
    () => del(`/admin/export-profiles/${encodeURIComponent(target.id)}`),
    m.admin_pdf_profile_deleted(),
  );
  await invalidate("app:export-profiles");
}
</script>

<svelte:head
  ><title>{m.admin_tab_pdf()} · {m.nav_admin_settings()} · Sammelband</title></svelte:head
>

<div class="grid max-w-2xl gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.general_pdf_export_title()}</Card.Title>
      <Card.Description>
        {m.general_pdf_export_description({ sammelband: auth.tenant?.name ?? "Sammelband" })}
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <div class="flex items-center justify-between gap-4">
        <Label for="pdf-export">{m.general_pdf_export_switch()}</Label>
        <Switch
          id="pdf-export"
          bind:checked={pdfExport}
          disabled={savingPdfExport}
          onCheckedChange={savePdfExport}
        />
      </div>
    </Card.Content>
  </Card.Root>

  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="font-heading text-lg">{m.admin_pdf_profiles_title()}</h2>
      <p class="text-sm text-muted-foreground">{m.admin_pdf_profiles_description()}</p>
      {#if !pdfExport}
        <p class="mt-1 text-sm text-muted-foreground">{m.admin_pdf_export_off_note()}</p>
      {/if}
    </div>
    <Button variant="outline" onclick={create}><Plus /> {m.admin_pdf_profile_new()}</Button>
  </div>

  {#each EXPORT_PURPOSES as p (p)}
    <Card.Root>
      <Card.Header class="flex flex-row items-start justify-between gap-4">
        <Card.Title>{purposeLabel(p)}</Card.Title>
        <Switch
          checked={purposeOn(p)}
          disabled={busy}
          aria-label={m.admin_pdf_purpose_switch({ purpose: purposeLabel(p) })}
          onCheckedChange={(on) => togglePurpose(p, on)}
        />
      </Card.Header>
      <Card.Content>
        <ul class="divide-y">
          {#each byPurpose(p) as x (x.id)}
            <li class="flex items-center gap-3 py-2.5">
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-2 text-sm font-medium">
                  <span class="truncate">{profileLabel(x)}</span>
                  {#if !x.builtin}
                    <Badge variant="secondary">{m.admin_pdf_profile_own()}</Badge>
                  {/if}
                </p>
                <p class="text-xs text-muted-foreground">{profileSummary(x.spec)}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                {#if x.builtin}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={m.admin_pdf_profile_duplicate()}
                    title={m.admin_pdf_profile_duplicate()}
                    onclick={() => duplicate(x)}
                    ><Copy /></Button
                  >
                {:else}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={m.admin_pdf_profile_edit()}
                    title={m.admin_pdf_profile_edit()}
                    onclick={() => edit(x)}
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
                {/if}
                <Switch
                  class="ml-2"
                  checked={x.enabled}
                  disabled={busy}
                  aria-label={m.admin_pdf_profile_switch({ name: profileLabel(x) })}
                  onCheckedChange={(on) => toggle(x, on)}
                />
              </div>
            </li>
          {/each}
        </ul>
      </Card.Content>
    </Card.Root>
  {/each}
</div>

{#if editing}
  <ProfileDialog
    bind:open={dialogOpen}
    id={editing.id}
    name={editing.name}
    spec={editing.spec}
    onsaved={() => invalidate("app:export-profiles")}
  />
{/if}

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.admin_pdf_profile_delete_confirm({ name: deleting?.name ?? "" })}
  description={m.admin_pdf_profile_delete_description()}
  onconfirm={remove}
/>
