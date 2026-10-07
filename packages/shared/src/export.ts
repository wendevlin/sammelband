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

export type ExportOptions = {
  purpose: ExportPurpose;
  /** Photo captions with the photos. */
  captions: boolean;
};

export type ExportStatus = "queued" | "running" | "done" | "failed";

/** A PDF of an album: queued, being made, ready to download, or failed. */
export type AlbumExport = {
  id: string;
  album_id: string;
  /** File name without ".pdf"; the album title unless renamed. */
  name: string;
  format: ExportFormat;
  options: ExportOptions;
  status: ExportStatus;
  /** 0–100 while running. */
  progress: number;
  /** Error code when failed (translated like API errors). */
  error_code: string | null;
  page_count: number | null;
  file_size: number | null;
  created_by: string | null;
  created_at: number;
  finished_at: number | null;
};
