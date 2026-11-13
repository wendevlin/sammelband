import {
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportProfileSnapshot,
  type ExportProfileSpec,
  type ExportPurpose,
} from "@sammelband/shared";
import { getLocale } from "#lib/i18n.ts";
import { m } from "#lib/paraglide/messages.js";

export function formatLabel(format: ExportFormat): string {
  return {
    a4: m.export_format_a4,
    "a4-landscape": m.export_format_a4_landscape,
    a5: m.export_format_a5,
    "a5-landscape": m.export_format_a5_landscape,
    "square-21": m.export_format_square_21,
    letter: m.export_format_letter,
  }[format]();
}

export function purposeLabel(purpose: ExportPurpose): string {
  return {
    home: m.export_purpose_home,
    print: m.export_purpose_print,
    screen: m.export_purpose_screen,
  }[purpose]();
}

/** Built-in profiles with a name of their own (not just their page format). */
const NAMED: Record<string, () => string> = {
  "print:a4-landscape": m.export_profile_print_a4_landscape,
  "print:saal-layflat-275x193": m.export_profile_saal_layflat,
};

/** A profile's name: its own, or for built-in ones the page format (or a service). */
export function profileLabel(profile: Pick<ExportProfileSnapshot, "id" | "builtin" | "name">) {
  if (!profile.builtin) return profile.name ?? "";
  const named = NAMED[profile.id];
  if (named) return named();
  const format = profile.id.split(":")[1] ?? "";
  return (EXPORT_FORMATS as readonly string[]).includes(format)
    ? formatLabel(format as ExportFormat)
    : profile.id;
}

const num = (mm: number) =>
  new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(mm);

/** What a profile makes, in a line: "275 × 193 mm · 3 mm bleed · spreads · 26–160 pages · separate cover". */
export function profileSummary(spec: ExportProfileSpec): string {
  const parts = [
    m.export_profile_size({ width: num(spec.pageWidthMm), height: num(spec.pageHeightMm) }),
  ];
  if (spec.bleedMm > 0) parts.push(m.export_profile_bleed({ bleed: num(spec.bleedMm) }));
  if (spec.layout === "spread") parts.push(m.export_profile_spreads());
  const { min, max } = spec.pages;
  if (min !== null && max !== null) parts.push(m.export_profile_pages_range({ min, max }));
  else if (min !== null) parts.push(m.export_profile_pages_min({ min }));
  else if (max !== null) parts.push(m.export_profile_pages_max({ max }));
  if (spec.cover.mode === "separate") parts.push(m.export_profile_cover_separate());
  if (spec.cover.mode === "none") parts.push(m.export_profile_cover_none());
  parts.push(m.export_profile_dpi({ dpi: spec.dpi }));
  return parts.join(" · ");
}

/** A page (or spread) preview's size in px: its proportions, at most `h` high and `w` wide. */
export function previewSize(spec: ExportProfileSpec, h = 40, w = 48) {
  const width = spec.pageWidthMm * (spec.layout === "spread" ? 2 : 1);
  const k = Math.min(h / spec.pageHeightMm, w / width);
  return { width: Math.round(width * k), height: Math.round(spec.pageHeightMm * k) };
}
