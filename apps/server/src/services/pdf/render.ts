import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import {
  type Geometry,
  geometry,
  type Layout,
  type LayoutInput,
  layoutAlbum,
  type Page,
  type PhotoBox,
} from "./layout";
import type { Line } from "./text";
import { COLORS, FONT_FILES, type FontKey } from "./theme";

// Draws a layout (layout.ts) with pdfkit. Images are resized with Bun.Image to
// the size they're printed at (the purpose's dpi: 300 for paper, 150 for the
// screen), never enlarged, and embedded as JPEG. With a bleed, every page is
// that much larger and says where it will be trimmed (TrimBox, BleedBox), as
// print shops expect. The cover and the interior are drawn by separate
// functions, so that a print service can later get them as two files.

export type RenderInput = LayoutInput & {
  /** Path of a photo's original, by photo id. */
  original: (photoId: string) => string;
  /** 0–1. Preparing images is most of the work. */
  onProgress?: (share: number) => void | Promise<void>;
};

export type RenderResult = { pages: number };

type Doc = PDFKit.PDFDocument;

function newDocument(g: Geometry, title: string): Doc {
  const doc = new PDFDocument({
    size: [g.width + 2 * g.bleed, g.height + 2 * g.bleed],
    margin: 0,
    autoFirstPage: false,
    info: { Title: title, Creator: "Sammelband", Producer: "Sammelband" },
    displayTitle: true,
  });
  for (const [key, spec] of Object.entries(FONT_FILES)) {
    doc.registerFont(key, Bun.resolveSync(spec, import.meta.dir));
  }
  return doc;
}

/** Text widths for the layout, from the embedded fonts. */
function measurer(doc: Doc) {
  return (text: string, font: FontKey, size: number) =>
    doc.font(font).fontSize(size).widthOfString(text);
}

/** Lay out and write the album as one PDF: cover, interior, back. */
export async function renderAlbumPdf(input: RenderInput, outPath: string): Promise<RenderResult> {
  const doc = newDocument(geometry(input.format, input.purpose), input.title);
  const layout = layoutAlbum(input, measurer(doc));
  const tmp = mkdtempSync(join(tmpdir(), "sammelband-pdf-"));
  try {
    const images = await prepareImages(layout, input, tmp);
    const done = new Promise<void>((resolve, reject) => {
      const out = createWriteStream(outPath);
      out.on("finish", resolve);
      out.on("error", reject);
      doc.on("error", reject);
      doc.pipe(out);
    });
    const total = layout.pages.length;
    for (const [i, page] of layout.pages.entries()) {
      if (page.kind === "cover") renderCover(doc, layout.geometry, page, images);
      else renderInterior(doc, layout.geometry, page, images);
      await input.onProgress?.(0.85 + (0.15 * (i + 1)) / total);
    }
    doc.end();
    await done;
    return { pages: total };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Resized JPEGs of every photo in the layout, by photo id. */
async function prepareImages(
  layout: Layout,
  input: RenderInput,
  dir: string,
): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  const { dpi } = input.purpose;
  const quality = dpi >= 300 ? 88 : 80;
  const entries = [...layout.photoSizes];
  for (const [i, [id, size]] of entries.entries()) {
    const width = Math.max(1, Math.ceil((size.w / 72) * dpi));
    const bytes = await new Bun.Image(input.original(id))
      .resize(width, undefined, { withoutEnlargement: true })
      .jpeg({ quality })
      .bytes();
    const path = join(dir, `${i}.jpg`);
    await Bun.write(path, bytes);
    paths.set(id, path);
    await input.onProgress?.((0.85 * (i + 1)) / entries.length);
  }
  return paths;
}

/** The front: the cover photo edge to edge with the title, or the title on paper. */
export function renderCover(
  doc: Doc,
  g: Geometry,
  page: Extract<Page, { kind: "cover" }>,
  images: Map<string, string>,
): void {
  addPage(doc, g);
  const pw = g.width + 2 * g.bleed;
  const ph = g.height + 2 * g.bleed;
  const image = page.photo && images.get(page.photo.id);
  const lineHeights = page.title.reduce((sum, l) => sum + l.height, 0);
  if (image) {
    doc.save();
    doc.rect(0, 0, pw, ph).clip();
    doc.image(image, 0, 0, { cover: [pw, ph], align: "center", valign: "center" });
    doc.restore();
    // A soft shade at the bottom so the white title reads on any photo.
    const shadeTop = ph - Math.max(ph * 0.45, lineHeights + g.margin * 2.5);
    const shade = doc.linearGradient(0, shadeTop, 0, ph);
    shade.stop(0, "#000000", 0).stop(0.55, "#000000", 0.35).stop(1, "#000000", 0.6);
    doc.rect(0, shadeTop, pw, ph - shadeTop).fill(shade);
    let y = g.bleed + g.height - g.margin * 1.3 - lineHeights;
    for (const line of page.title) {
      drawLine(doc, g.bleed + g.margin, y, line, g.w);
      y += line.height;
    }
    return;
  }
  doc.rect(0, 0, pw, ph).fill(COLORS.paper);
  const logo = 44 * g.scale;
  const blockH = logo + 24 * g.scale + lineHeights;
  let y = g.bleed + (g.height - blockH) / 2.2;
  drawLogo(doc, g.bleed + (g.width - logo) / 2, y, logo, COLORS.primary, COLORS.paper);
  y += logo + 24 * g.scale;
  for (const line of page.title) {
    drawLine(doc, g.bleed + g.margin, y, line, g.w);
    y += line.height;
  }
}

/** Every other page: description and sections, blank pages, the back. */
export function renderInterior(
  doc: Doc,
  g: Geometry,
  page: Exclude<Page, { kind: "cover" }>,
  images: Map<string, string>,
): void {
  addPage(doc, g);
  if (page.kind === "blank") return;
  if (page.kind === "back") {
    const logo = 22 * g.scale;
    const x = g.bleed + (g.width - logo) / 2;
    const y = g.bleed + g.height - g.margin - logo * 2.4;
    drawLogo(doc, x, y, logo, COLORS.primary, COLORS.white);
    doc
      .font("heading")
      .fontSize(10 * g.scale)
      .fillColor(COLORS.muted);
    const label = "Sammelband";
    const width = doc.widthOfString(label);
    doc.text(label, g.bleed + (g.width - width) / 2, y + logo + 6 * g.scale, {
      lineBreak: false,
    });
    return;
  }

  for (const box of page.boxes) {
    if (box.kind === "rect") {
      doc.roundedRect(g.bleed + box.x, g.bleed + box.y, box.w, box.h, box.radius).fill(box.fill);
    } else if (box.kind === "text") {
      drawLine(doc, g.bleed + box.x, g.bleed + box.y, box.line, box.width);
    } else {
      drawPhoto(doc, g, box, images.get(box.id));
    }
  }

  // Page number, small, at the bottom centre (not on pages of only photos).
  if (page.number === null) return;
  const label = String(page.number);
  doc
    .font("body")
    .fontSize(Math.max(7, 8 * g.scale))
    .fillColor(COLORS.muted);
  const width = doc.widthOfString(label);
  doc.text(label, g.bleed + (g.width - width) / 2, g.bleed + g.height - g.margin * 0.6, {
    lineBreak: false,
  });
}

/** A page of the trimmed size plus the bleed, marked for the print shop. */
function addPage(doc: Doc, g: Geometry): void {
  doc.addPage();
  if (g.bleed <= 0) return;
  // PDF boxes are [left, bottom, right, top] from the bottom left.
  const w = g.width + 2 * g.bleed;
  const h = g.height + 2 * g.bleed;
  const data = doc.page.dictionary.data as Record<string, unknown>;
  data.TrimBox = [g.bleed, g.bleed, w - g.bleed, h - g.bleed];
  data.BleedBox = [0, 0, w, h];
}

/** A photo in its box (cropped at the centre when `cover`), with its caption. */
function drawPhoto(doc: Doc, g: Geometry, box: PhotoBox, image: string | undefined): void {
  const x = g.bleed + box.x;
  const y = g.bleed + box.y;
  if (image) {
    if (box.cover) {
      doc.save();
      doc.rect(x, y, box.w, box.h).clip();
      doc.image(image, x, y, { cover: [box.w, box.h], align: "center", valign: "center" });
      doc.restore();
    } else {
      doc.image(image, x, y, { width: box.w, height: box.h });
    }
  }
  const caption = box.caption;
  if (!caption) return;
  // A soft shade from above the caption down to the photo's bottom, so white text reads.
  const lineH = caption.lines.reduce((sum, l) => sum + l.height, 0);
  const top = g.bleed + caption.y - lineH * 1.2;
  const bottom = y + box.h;
  doc.save();
  doc.rect(x, y, box.w, box.h).clip();
  const shade = doc.linearGradient(0, top, 0, bottom);
  shade.stop(0, "#000000", 0).stop(0.6, "#000000", 0.4).stop(1, "#000000", 0.55);
  doc.rect(x, top, box.w, bottom - top).fill(shade);
  doc.restore();
  let ly = g.bleed + caption.y;
  for (const line of caption.lines) {
    drawLine(doc, g.bleed + caption.x, ly, line, line.width);
    ly += line.height;
  }
}

/** One line of text at (x, y), its top; `width` is the space for centred lines and rules. */
function drawLine(doc: Doc, x: number, y: number, line: Line, width: number): void {
  if (line.rule) {
    const w = line.width || width - line.indent;
    doc
      .moveTo(x + line.indent, y + line.height / 2)
      .lineTo(x + line.indent + w, y + line.height / 2)
      .lineWidth(line.width ? 1.5 : 0.75)
      .strokeColor(line.width ? line.color : COLORS.border)
      .stroke();
    return;
  }
  const left = line.align === "center" ? x + (width - line.width) / 2 : x + line.indent;
  doc.fontSize(line.size);
  if (line.quote) {
    doc.rect(x + line.indent - line.size * 0.75, y, 1.5, line.height).fill(COLORS.border);
  }
  for (const span of line.spans) {
    doc.font(span.font).fontSize(line.size);
    // Centre the font's line box in the layout's line height.
    const top = y + (line.height - doc.currentLineHeight(true)) / 2;
    doc.fillColor(span.link ? COLORS.primary : line.color);
    doc.text(span.text, left + span.x, top, {
      lineBreak: false,
      ...(span.link && { link: span.link, underline: true }),
    });
  }
  if (line.marker) {
    doc.font("body").fontSize(line.size).fillColor(line.color);
    const top = y + (line.height - doc.currentLineHeight(true)) / 2;
    const w = doc.widthOfString(line.marker);
    doc.text(line.marker, x + line.indent - w - line.size * 0.5, top, { lineBreak: false });
  }
}

/** Sammelband's mark (app/logo.svelte, viewBox 4 4 24 24) at `size` pt. */
function drawLogo(doc: Doc, x: number, y: number, size: number, color: string, paper: string) {
  const k = size / 24;
  const r = (rx: number, ry: number, w: number, h: number, radius: number) =>
    doc.roundedRect(x + (rx - 4) * k, y + (ry - 4) * k, w * k, h * k, radius * k);
  doc.save();
  r(8.5, 6.5, 16, 19.5, 1.6).fillOpacity(0.55).fill(color);
  doc.fillOpacity(1);
  r(7.5, 5.5, 16, 19.5, 1.4).fill(color);
  for (const [rx, ry, w, h, radius] of [
    [9.7, 5.5, 0.5, 19.5, 0],
    [11.4, 7.8, 10, 6, 0.6],
    [11.4, 14.8, 6, 1.2, 0.6],
    [11.4, 16.6, 10, 0.7, 0.35],
    [11.4, 17.9, 7, 0.7, 0.35],
    [11.4, 19.2, 4.5, 4, 0.5],
    [16.9, 19.2, 4.5, 4, 0.5],
  ] as const) {
    r(rx, ry, w, h, radius).fill(paper);
  }
  doc.restore();
}
