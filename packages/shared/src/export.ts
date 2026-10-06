// PDF export of albums: page formats and the export rows the API returns.
// Page geometry is data, so a print service can later bring its own formats
// and page-count rules without touching the layout code.

export type PageFormat = {
  /** Trim size: the finished page, in mm. */
  width: number;
  height: number;
  /** Extra paper around the trim that print shops cut off, in mm. */
  bleed: number;
  /** Total pages must be a multiple of this (2: every sheet has two sides). */
  pageMultiple: number;
};

export const EXPORT_FORMATS = ["a4", "a4-landscape", "a5", "square-21", "letter"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const PAGE_FORMATS: Record<ExportFormat, PageFormat> = {
  a4: { width: 210, height: 297, bleed: 0, pageMultiple: 2 },
  "a4-landscape": { width: 297, height: 210, bleed: 0, pageMultiple: 2 },
  a5: { width: 148, height: 210, bleed: 0, pageMultiple: 2 },
  "square-21": { width: 210, height: 210, bleed: 0, pageMultiple: 2 },
  letter: { width: 215.9, height: 279.4, bleed: 0, pageMultiple: 2 },
};

/** Print: 300 dpi images, for paper. Screen: 150 dpi, a quarter of the size. */
export const EXPORT_QUALITIES = ["print", "screen"] as const;
export type ExportQuality = (typeof EXPORT_QUALITIES)[number];

export type ExportOptions = {
  quality: ExportQuality;
  /** Photo captions under the photos. */
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
