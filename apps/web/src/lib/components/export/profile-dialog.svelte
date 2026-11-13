<script lang="ts">
import {
  EXPORT_PURPOSES,
  type ExportProfile,
  type ExportProfileSpec,
  type ExportPurpose,
} from "@sammelband/shared";
import { api, post } from "#lib/api.ts";
import { attempt } from "#lib/attempt.ts";
import SimpleSelect from "#lib/components/app/simple-select.svelte";
import { Button } from "#lib/components/ui/button/index.ts";
import * as Dialog from "#lib/components/ui/dialog/index.ts";
import { Input } from "#lib/components/ui/input/index.ts";
import { Label } from "#lib/components/ui/label/index.ts";
import { Switch } from "#lib/components/ui/switch/index.ts";
import { m } from "#lib/paraglide/messages.js";
import { purposeLabel } from "./format-label";
import ProfilePreview from "./profile-preview.svelte";

/**
 * Create or edit an own print profile (`id` null: a new one, e.g. a copy of
 * a built-in profile). All sizes in mm; the preview shows the PDF page and
 * the cover to scale as they are typed.
 */
let {
  open = $bindable(false),
  id,
  name,
  spec,
  onsaved,
}: {
  open?: boolean;
  id: string | null;
  name: string;
  spec: ExportProfileSpec;
  onsaved: () => unknown;
} = $props();

type CoverMode = ExportProfileSpec["cover"]["mode"];
type Draft = {
  name: string;
  purpose: ExportPurpose;
  pageWidthMm: number | null;
  pageHeightMm: number | null;
  bleedMm: number | null;
  dpi: number | null;
  edgeToEdge: boolean;
  layout: "single" | "spread";
  firstPageRight: boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  gutterMm: number | null;
  logo: boolean;
  cover: CoverMode;
  panelWidthMm: number | null;
  panelHeightMm: number | null;
  coverBleedMm: number | null;
  spine: "fixed" | "pages";
  spineFixedMm: number | null;
  spineBaseMm: number | null;
  spinePerPageMm: number | null;
};

function toDraft(name: string, s: ExportProfileSpec): Draft {
  const c = s.cover.mode === "separate" ? s.cover : null;
  const spine = c?.spine;
  return {
    name,
    purpose: s.purpose,
    pageWidthMm: s.pageWidthMm,
    pageHeightMm: s.pageHeightMm,
    bleedMm: s.bleedMm,
    dpi: s.dpi,
    edgeToEdge: s.edgeToEdge,
    layout: s.layout,
    firstPageRight: s.firstPageRight,
    min: s.pages.min,
    max: s.pages.max,
    step: s.pages.step,
    gutterMm: s.gutterMm,
    logo: s.logo,
    cover: s.cover.mode,
    panelWidthMm: c?.panelWidthMm ?? s.pageWidthMm,
    panelHeightMm: c?.panelHeightMm ?? s.pageHeightMm,
    coverBleedMm: c?.bleedMm ?? 15,
    spine: spine && "fixedMm" in spine ? "fixed" : "pages",
    spineFixedMm: spine && "fixedMm" in spine ? spine.fixedMm : 10,
    spineBaseMm: spine && "baseMm" in spine ? spine.baseMm : 5,
    spinePerPageMm: spine && "perPageMm" in spine ? spine.perPageMm : 0.25,
  };
}

/** Empty number fields read as null (or NaN): the fallback then. */
const n = (v: number | null | undefined, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const optional = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;

function toSpec(d: Draft): ExportProfileSpec {
  return {
    purpose: d.purpose,
    pageWidthMm: n(d.pageWidthMm, 0),
    pageHeightMm: n(d.pageHeightMm, 0),
    bleedMm: n(d.bleedMm, 0),
    dpi: Math.round(n(d.dpi, 300)),
    edgeToEdge: d.edgeToEdge,
    layout: d.layout,
    firstPageRight: d.layout === "spread" && d.firstPageRight,
    pages: { min: optional(d.min), max: optional(d.max), step: Math.round(n(d.step, 1)) },
    gutterMm: n(d.gutterMm, 0),
    logo: d.logo,
    cover:
      d.cover === "separate"
        ? {
            mode: "separate",
            panelWidthMm: n(d.panelWidthMm, 0),
            panelHeightMm: n(d.panelHeightMm, 0),
            bleedMm: n(d.coverBleedMm, 0),
            spine:
              d.spine === "fixed"
                ? { fixedMm: n(d.spineFixedMm, 0) }
                : { baseMm: n(d.spineBaseMm, 0), perPageMm: n(d.spinePerPageMm, 0) },
          }
        : { mode: d.cover },
  };
}

let draft = $state<Draft>(toDraft("", { ...EMPTY_SPEC() }));
$effect(() => {
  // A fresh form each time it opens.
  if (open) draft = toDraft(name, spec);
});
const preview = $derived(toSpec(draft));
let busy = $state(false);

function EMPTY_SPEC(): ExportProfileSpec {
  return {
    purpose: "print",
    pageWidthMm: 210,
    pageHeightMm: 297,
    bleedMm: 3,
    dpi: 300,
    edgeToEdge: true,
    layout: "single",
    firstPageRight: false,
    pages: { min: null, max: null, step: 2 },
    gutterMm: 0,
    logo: true,
    cover: { mode: "pages" },
  };
}

async function save(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  const body = { name: draft.name, spec: toSpec(draft) };
  const saved = await attempt(
    () =>
      id
        ? api<ExportProfile>(`/admin/export-profiles/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body,
          })
        : post<ExportProfile>("/admin/export-profiles", body),
    m.admin_pdf_profile_saved(),
  );
  busy = false;
  if (!saved) return;
  open = false;
  await onsaved();
}

const purposes = EXPORT_PURPOSES.map((p) => ({ value: p, label: purposeLabel(p) }));
const layouts = [
  { value: "single", label: m.profile_layout_single() },
  { value: "spread", label: m.profile_layout_spread() },
];
const covers = [
  { value: "pages", label: m.profile_cover_pages() },
  { value: "separate", label: m.profile_cover_separate() },
  { value: "none", label: m.profile_cover_none() },
];
const spines = [
  { value: "pages", label: m.profile_spine_pages() },
  { value: "fixed", label: m.profile_spine_fixed() },
];
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title
        >{id ? m.profile_dialog_edit_title() : m.profile_dialog_new_title()}</Dialog.Title
      >
      <Dialog.Description>{m.profile_dialog_description()}</Dialog.Description>
    </Dialog.Header>

    <form id="profile-form" class="grid gap-5" onsubmit={save}>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="grid gap-1.5 sm:col-span-2">
          <Label for="profile-name">{m.common_name()}</Label>
          <Input id="profile-name" bind:value={draft.name} required maxlength={100} />
        </div>
        <div class="grid gap-1.5">
          <Label>{m.export_purpose()}</Label>
          <SimpleSelect
            label={m.export_purpose()}
            value={draft.purpose}
            options={purposes}
            onchange={(v) => (draft.purpose = v as ExportPurpose)}
            class="w-full"
          />
        </div>
        <div class="grid gap-1.5">
          <Label>{m.profile_field_layout()}</Label>
          <SimpleSelect
            label={m.profile_field_layout()}
            value={draft.layout}
            options={layouts}
            onchange={(v) => {
              draft.layout = v as Draft["layout"];
              // Spreads come in pairs.
              if (draft.layout === "spread" && (draft.step ?? 1) % 2 === 1)
                draft.step = (draft.step ?? 1) * 2;
            }}
            class="w-full"
          />
        </div>
      </div>

      <fieldset class="grid gap-3">
        <legend class="mb-1 text-sm font-medium">{m.profile_field_page()}</legend>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {@render number(
            "profile-width",
            m.profile_field_width(),
            draft.pageWidthMm,
            (v) => (draft.pageWidthMm = v),
            0.1,
          )}
          {@render number(
            "profile-height",
            m.profile_field_height(),
            draft.pageHeightMm,
            (v) => (draft.pageHeightMm = v),
            0.1,
          )}
          {@render number(
            "profile-bleed",
            m.profile_field_bleed(),
            draft.bleedMm,
            (v) => (draft.bleedMm = v),
            0.1,
          )}
          {@render number(
            "profile-dpi",
            m.profile_field_dpi(),
            draft.dpi,
            (v) => (draft.dpi = v),
            1,
          )}
        </div>
        <div class="flex items-center justify-between gap-4">
          <Label for="profile-edge">{m.profile_field_edge()}</Label>
          <Switch id="profile-edge" bind:checked={draft.edgeToEdge} />
        </div>
        {#if draft.layout === "spread"}
          <div class="flex items-center justify-between gap-4">
            <Label for="profile-first-right">{m.profile_field_first_right()}</Label>
            <Switch id="profile-first-right" bind:checked={draft.firstPageRight} />
          </div>
        {/if}
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {@render number(
            "profile-gutter",
            m.profile_field_gutter(),
            draft.gutterMm,
            (v) => (draft.gutterMm = v),
            0.1,
          )}
        </div>
        <p class="text-xs text-muted-foreground">{m.profile_field_gutter_hint()}</p>
      </fieldset>

      <fieldset class="grid gap-3">
        <legend class="mb-1 text-sm font-medium">{m.profile_field_pages()}</legend>
        <div class="grid grid-cols-3 gap-3">
          {@render number(
            "profile-min",
            m.profile_field_min(),
            draft.min,
            (v) => (draft.min = v),
            1,
            true,
          )}
          {@render number(
            "profile-max",
            m.profile_field_max(),
            draft.max,
            (v) => (draft.max = v),
            1,
            true,
          )}
          {@render number(
            "profile-step",
            m.profile_field_step(),
            draft.step,
            (v) => (draft.step = v),
            1,
          )}
        </div>
        <p class="text-xs text-muted-foreground">{m.profile_field_pages_hint()}</p>
      </fieldset>

      <fieldset class="grid gap-3">
        <legend class="mb-1 text-sm font-medium">{m.profile_field_cover()}</legend>
        <SimpleSelect
          label={m.profile_field_cover()}
          value={draft.cover}
          options={covers}
          onchange={(v) => (draft.cover = v as CoverMode)}
          class="w-full"
        />
        {#if draft.cover === "separate"}
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {@render number(
              "profile-panel-width",
              m.profile_field_panel_width(),
              draft.panelWidthMm,
              (v) => (draft.panelWidthMm = v),
              0.1,
            )}
            {@render number(
              "profile-panel-height",
              m.profile_field_panel_height(),
              draft.panelHeightMm,
              (v) => (draft.panelHeightMm = v),
              0.1,
            )}
            {@render number(
              "profile-cover-bleed",
              m.profile_field_cover_bleed(),
              draft.coverBleedMm,
              (v) => (draft.coverBleedMm = v),
              0.1,
            )}
          </div>
          <div class="grid gap-1.5">
            <Label>{m.profile_field_spine()}</Label>
            <SimpleSelect
              label={m.profile_field_spine()}
              value={draft.spine}
              options={spines}
              onchange={(v) => (draft.spine = v as Draft["spine"])}
              class="w-full"
            />
          </div>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {#if draft.spine === "fixed"}
              {@render number(
                "profile-spine-fixed",
                m.profile_field_spine_width(),
                draft.spineFixedMm,
                (v) => (draft.spineFixedMm = v),
                0.1,
              )}
            {:else}
              {@render number(
                "profile-spine-base",
                m.profile_field_spine_base(),
                draft.spineBaseMm,
                (v) => (draft.spineBaseMm = v),
                0.1,
              )}
              {@render number(
                "profile-spine-per-page",
                m.profile_field_spine_per_page(),
                draft.spinePerPageMm,
                (v) => (draft.spinePerPageMm = v),
                0.001,
              )}
            {/if}
          </div>
        {/if}
        {#if draft.cover !== "none"}
          <div class="flex items-center justify-between gap-4">
            <Label for="profile-logo">{m.profile_field_logo()}</Label>
            <Switch id="profile-logo" bind:checked={draft.logo} />
          </div>
        {/if}
      </fieldset>

      <fieldset class="grid gap-2">
        <legend class="mb-1 text-sm font-medium">{m.profile_preview()}</legend>
        <ProfilePreview spec={preview} />
      </fieldset>
    </form>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (open = false)}>{m.common_cancel()}</Button>
      <Button type="submit" form="profile-form" disabled={busy || !draft.name.trim()}
        >{m.common_save()}</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

{#snippet number(
  inputId: string,
  label: string,
  value: number | null,
  set: (v: number | null) => void,
  step: number,
  optionalField = false,
)}
  <div class="grid gap-1.5">
    <Label for={inputId}>{label}</Label>
    <Input
      id={inputId}
      type="number"
      inputmode="decimal"
      min="0"
      {step}
      {value}
      placeholder={optionalField ? "–" : undefined}
      required={!optionalField}
      oninput={(e) => {
        const input = e.currentTarget as HTMLInputElement;
        // Half typed ("1.", "-"): the browser reports "", keep what is there.
        if (input.value === "" && input.validity.badInput) return;
        set(input.value === "" ? null : Number(input.value));
      }}
    />
  </div>
{/snippet}
