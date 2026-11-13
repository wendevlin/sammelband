// PDF export of albums: page formats, purposes and the export rows the API
// returns. Page geometry is data, so a print service can later bring its own
// formats, bleed and page-count rules without touching the layout code.

export type PageFormat = {
  /** Trim size: the finished page, in mm. */
  width: number;
  height: number;
  /** Printed books: total pages must be a multiple of this (2: every sheet has two sides). */
  pageMultiple: number;
};

export const EXPORT_FORMATS = [
  "a4",
  "a4-landscape",
  "a5",
  "a5-landscape",
  "square-21",
  "letter",
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const PAGE_FORMATS: Record<ExportFormat, PageFormat> = {
  a4: { width: 210, height: 297, pageMultiple: 2 },
  "a4-landscape": { width: 297, height: 210, pageMultiple: 2 },
  a5: { width: 148, height: 210, pageMultiple: 2 },
  "a5-landscape": { width: 210, height: 148, pageMultiple: 2 },
  "square-21": { width: 210, height: 210, pageMultiple: 2 },
  letter: { width: 215.9, height: 279.4, pageMultiple: 2 },
};

/**
 * What the PDF is for. A home printer can't print to the edge of the paper, a
 * print shop trims the pages and needs photos to run 3 mm past the edge (the
 * bleed), a screen needs neither and no blank pages to fill a printed sheet.
 */
export const EXPORT_PURPOSES = ["home", "print", "screen"] as const;
export type ExportPurpose = (typeof EXPORT_PURPOSES)[number];

export type PurposeSpec = {
  /** Image resolution at the printed size. */
  dpi: number;
  /** Paper the print shop cuts off around each page, in mm. */
  bleedMm: number;
  /** Photos run to the edges of the page (text keeps its margins). */
  edgeToEdge: boolean;
  /** Blank pages before the back, up to the format's page multiple. */
  padPages: boolean;
};

export const PURPOSES: Record<ExportPurpose, PurposeSpec> = {
  home: { dpi: 300, bleedMm: 0, edgeToEdge: false, padPages: true },
  print: { dpi: 300, bleedMm: 3, edgeToEdge: true, padPages: true },
  screen: { dpi: 150, bleedMm: 0, edgeToEdge: true, padPages: false },
};

// --- Print profiles -----------------------------------------------------------
//
// A profile is everything a PDF has to be like for where it goes: the page
// size, bleed and resolution, whether a PDF page is one book page or a spread
// (both facing pages, as Saal Digital wants them for layflat books), how many
// pages the book may have, and where the cover goes. The built-in profiles are
// the page formats for each purpose; a Sammelband's admins add their own and
// switch off the ones nobody there needs.

/** The book's spine, in mm: fixed, or growing with the interior pages. */
export type SpineSpec = { fixedMm: number } | { baseMm: number; perPageMm: number };

export type CoverSpec =
  /** The front is the PDF's first page, the back its last (one file). */
  | { mode: "pages" }
  /** Neither: the print service makes the cover itself. */
  | { mode: "none" }
  /**
   * A second PDF of one sheet: back, spine and front side by side, each panel
   * `panelWidthMm` × `panelHeightMm`, with `bleedMm` around the whole sheet
   * (for a hardcover, the paper that wraps around the boards).
   */
  | {
      mode: "separate";
      panelWidthMm: number;
      panelHeightMm: number;
      bleedMm: number;
      spine: SpineSpec;
    };

export type ExportProfileSpec = {
  purpose: ExportPurpose;
  /** Trim size of one book page. */
  pageWidthMm: number;
  pageHeightMm: number;
  /** Paper cut off around each page; with spreads only on the outside, none at the fold. */
  bleedMm: number;
  /** Image resolution at the printed size. */
  dpi: number;
  /** Photos run to the edges of the page (text keeps its margins). */
  edgeToEdge: boolean;
  /** "spread": every PDF page holds two facing book pages (1+2, 3+4, …). */
  layout: "single" | "spread";
  /** Spreads: page 1 stands alone on the right (the first and last spread are half empty). */
  firstPageRight: boolean;
  /**
   * Book pages, as the PDF has them (with `cover: pages`, the front and back
   * count): at least `min`, at most `max`, a multiple of `step`. Missing pages
   * are filled with blank ones before the back.
   */
  pages: { min: number | null; max: number | null; step: number };
  /** Text and QR codes keep this much more distance from the fold, in mm. */
  gutterMm: number;
  /** Sammelband's mark on the back. */
  logo: boolean;
  cover: CoverSpec;
};

/** A profile as the API sends it; built-in ones are named by the web app (by id). */
export type ExportProfile = {
  id: string;
  builtin: boolean;
  /** Own profiles only. */
  name: string | null;
  enabled: boolean;
  spec: ExportProfileSpec;
};

/** What an export was made with, kept with it (the profile may change or go later). */
export type ExportProfileSnapshot = {
  id: string;
  builtin: boolean;
  name: string | null;
  spec: ExportProfileSpec;
};

/** The built-in profile of a page format and purpose: what the export did before profiles. */
export function formatProfileSpec(format: ExportFormat, purpose: ExportPurpose): ExportProfileSpec {
  const f = PAGE_FORMATS[format];
  const p = PURPOSES[purpose];
  return {
    purpose,
    pageWidthMm: f.width,
    pageHeightMm: f.height,
    bleedMm: p.bleedMm,
    dpi: p.dpi,
    edgeToEdge: p.edgeToEdge,
    layout: "single",
    firstPageRight: false,
    pages: { min: null, max: null, step: p.padPages ? f.pageMultiple : 1 },
    gutterMm: 0,
    logo: true,
    cover: { mode: "pages" },
  };
}

export const builtinProfileId = (purpose: ExportPurpose, format: ExportFormat) =>
  `${purpose}:${format}`;

/**
 * Saal Digital's layflat photo book, 27.5 × 19.3 cm landscape (closed): 26 to
 * 160 pages, one PDF page per spread, the cover as a second PDF, no logo.
 * Bleed, cover panel and spine follow Saal's templates; check them against
 * the current template before relying on them (admins can duplicate this
 * profile and adjust it).
 */
export const SAAL_LAYFLAT_275: ExportProfileSpec = {
  purpose: "print",
  pageWidthMm: 275,
  pageHeightMm: 193,
  bleedMm: 3,
  dpi: 300,
  edgeToEdge: true,
  layout: "spread",
  firstPageRight: false,
  pages: { min: 26, max: 160, step: 2 },
  gutterMm: 0,
  logo: false,
  cover: {
    mode: "separate",
    panelWidthMm: 275,
    panelHeightMm: 193,
    bleedMm: 15,
    spine: { baseMm: 5, perPageMm: 0.25 },
  },
};

/** Built-in profiles, in the order the export dialog shows them. */
export const BUILTIN_PROFILES: { id: string; spec: ExportProfileSpec }[] = [
  ...EXPORT_PURPOSES.flatMap((purpose) =>
    EXPORT_FORMATS.map((format) => ({
      id: builtinProfileId(purpose, format),
      spec: formatProfileSpec(format, purpose),
    })),
  ),
  { id: "print:saal-layflat-275x193", spec: SAAL_LAYFLAT_275 },
];

export function builtinProfile(id: string): { id: string; spec: ExportProfileSpec } | undefined {
  return BUILTIN_PROFILES.find((p) => p.id === id);
}

/** The spine of a separate cover for this many interior pages, in mm. */
export function spineWidthMm(spine: SpineSpec, pages: number): number {
  return "fixedMm" in spine ? spine.fixedMm : spine.baseMm + spine.perPageMm * pages;
}

/** PDF pages for this many book pages: the pages, or the spreads they make. */
export function sheetCount(spec: ExportProfileSpec, pages: number): number {
  if (spec.layout === "single") return pages;
  return Math.ceil((pages + (spec.firstPageRight ? 1 : 0)) / 2);
}

/** Hints about how a PDF came out, shown with it. */
export type ExportWarning =
  /** Blank pages added to reach the profile's page count. */
  | { code: "blank_pages"; params: { count: number } }
  /** Photos cropped noticeably to fill their pages. */
  | { code: "photos_cropped"; params: { count: number } };

export type ExportOptions = {
  purpose: ExportPurpose;
  /** Photo captions with the photos. */
  captions: boolean;
  /** A QR code on the back to the album online (a public link of the PDF's own). */
  album_link: boolean;
};

export type ExportStatus = "queued" | "running" | "done" | "failed";

/** A PDF of an album: queued, being made, ready to download, or failed. */
export type AlbumExport = {
  id: string;
  album_id: string;
  /** File name without ".pdf"; the album title unless renamed. */
  name: string;
  /** What it was made with. Exports from before profiles get their built-in one. */
  profile: ExportProfileSnapshot;
  options: ExportOptions;
  status: ExportStatus;
  /** 0–100 while running. */
  progress: number;
  /** Error code when failed (translated like API errors). */
  error_code: string | null;
  /** Book pages (with spreads, the PDF has fewer: `sheetCount`). */
  page_count: number | null;
  /** Both files, with a separate cover. */
  file_size: number | null;
  /** The profile wants the cover as a second PDF, and it is there once done. */
  has_cover_file: boolean;
  warnings: ExportWarning[];
  created_by: string | null;
  created_at: number;
  finished_at: number | null;
  /**
   * The album's `updated_at` the PDF was rendered from; once the album's is
   * newer, the export no longer matches it. Null before rendering (and for
   * exports from before this was recorded).
   */
  album_updated_at: number | null;
  /**
   * The public link the PDF's QR codes lead to: the album's videos. Made with
   * the PDF when the album has videos, deleted with it (or kept, if asked).
   */
  video_link: { id: string; url: string } | null;
  /**
   * The public link the QR code on the back leads to: the whole album. Made
   * with the PDF when asked for (`options.album_link`), and like the video
   * link deleted with it, or kept.
   */
  album_link: { id: string; url: string } | null;
};
