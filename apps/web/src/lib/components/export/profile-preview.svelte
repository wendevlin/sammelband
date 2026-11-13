<script lang="ts">
import { type ExportProfileSpec, spineWidthMm } from "@sammelband/shared";
import { m } from "#lib/paraglide/messages.js";
import { formatMm } from "./format-label";

/**
 * A profile to scale: one PDF page (a page or a spread) with its bleed, and a
 * separate cover sheet (back, spine, front). The bleed is the tinted band
 * outside the dashed trim line; a spread's fold is the line in the middle.
 */
let { spec }: { spec: ExportProfileSpec } = $props();

const pagesForSpine = $derived(spec.pages.min ?? 40);

function sheet(spec: ExportProfileSpec) {
  const pages = spec.layout === "spread" ? 2 : 1;
  const b = spec.bleedMm;
  return {
    w: pages * spec.pageWidthMm + 2 * b,
    h: spec.pageHeightMm + 2 * b,
    b,
    folds: pages === 2 ? [b + spec.pageWidthMm] : [],
  };
}

function cover(spec: ExportProfileSpec, pages: number) {
  if (spec.cover.mode !== "separate") return null;
  const c = spec.cover;
  const spine = spineWidthMm(c.spine, pages);
  const b = c.bleedMm;
  return {
    w: 2 * c.panelWidthMm + spine + 2 * b,
    h: c.panelHeightMm + 2 * b,
    b,
    folds: [b + c.panelWidthMm, b + c.panelWidthMm + spine],
  };
}

const sheets = $derived(
  [
    { label: m.profile_preview_pages(), box: sheet(spec) },
    { label: m.profile_preview_cover(), box: cover(spec, pagesForSpine) },
  ].flatMap((s) => (s.box ? [{ label: s.label, box: s.box }] : [])),
);
</script>

<div class="grid gap-3 sm:grid-cols-2">
  {#each sheets as s (s.label)}
    <figure class="grid gap-1">
      <svg
        viewBox="0 0 {s.box.w} {s.box.h}"
        class="w-full max-h-40"
        role="img"
        aria-label={s.label}
      >
        <rect width={s.box.w} height={s.box.h} class="fill-destructive/15" />
        <rect
          x={s.box.b}
          y={s.box.b}
          width={s.box.w - 2 * s.box.b}
          height={s.box.h - 2 * s.box.b}
          class="fill-card stroke-muted-foreground"
          stroke-dasharray="3 2"
          vector-effect="non-scaling-stroke"
        />
        {#each s.box.folds as x (x)}
          <line
            x1={x}
            x2={x}
            y1={s.box.b}
            y2={s.box.h - s.box.b}
            class="stroke-muted-foreground"
            vector-effect="non-scaling-stroke"
          />
        {/each}
      </svg>
      <figcaption class="text-xs text-muted-foreground">
        {s.label}
        · {m.export_profile_size({ width: formatMm(s.box.w), height: formatMm(s.box.h) })}
      </figcaption>
    </figure>
  {/each}
</div>
<p class="text-xs text-muted-foreground">{m.profile_preview_hint()}</p>
