import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportWarning } from "@sammelband/shared";
import PDFDocument from "pdfkit";
import { imageDecoding } from "../../lib/semaphore";
import {
  type CoverSheet,
  type Geometry,
  geometry,
  type Layout,
  type LayoutInput,
  layoutAlbum,
  MM,
  type Page,
  type PhotoBox,
  type Radii,
  type Side,
  safeArea,
} from "./layout";
import { drawLinkCode, drawVideoMark, type VideoMark } from "./qr";
import type { Line } from "./text";
import { COLORS, FONT_FILES, type FontKey } from "./theme";

// Draws a layout (layout.ts) with pdfkit. Images are resized with Bun.Image to
// the size they're printed at (the profile's dpi: 300 for paper, 150 for the
// screen), never enlarged, and embedded as JPEG. With a bleed, every PDF page
// is that much larger and says where it will be trimmed (TrimBox, BleedBox),
// as print shops expect.
//
// A PDF page (a sheet) holds one book page, or with spreads two facing ones
// side by side: the bleed runs around the sheet, not between the pages, and
// each page is clipped to its half, so nothing doubles or gaps at the fold.
// A separate cover is a second PDF of one sheet: back, spine, front.

export type RenderInput = LayoutInput & {
  /** Path of a photo's original, by photo id. */
  original: (photoId: string) => string;
  /** Videos, by photo id: drawn with a QR code to `url` (qr.ts). */
  videos?: Map<string, VideoMark>;
  /** The album online: a QR code to it on the back (`albumLink` makes room for it). */
  albumUrl?: string | null;
  /** 0–1. Preparing images is most of the work. */
  onProgress?: (share: number) => void | Promise<void>;
};

export type RenderResult = {
  /** Book pages in the (interior) PDF. */
  pages: number;
  /** PDF pages: the pages, or the spreads. */
  sheets: number;
  /** A cover was written to `coverPath`. */
  cover: boolean;
  warnings: ExportWarning[];
};

type Doc = PDFKit.PDFDocument;

/** Book pages on a sheet: one, or a left and a right page (null: empty half). */
type Sheet = { slots: (Page | null)[] };

function newDocument(size: [number, number], title: string): Doc {
  const doc = new PDFDocument({
    size,
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

/**
 * Lay out and write the album: one PDF of its pages (cover, interior, back),
 * and with a separate cover a second one at `coverPath`.
 */
export async function renderAlbumPdf(
  input: RenderInput,
  outPath: string,
  coverPath?: string,
): Promise<RenderResult> {
  const g = geometry(input.profile);
  const spread = g.spread;
  const sheetSize: [number, number] = [
    (spread ? 2 : 1) * g.width + 2 * g.bleed,
    g.height + 2 * g.bleed,
  ];
  const doc = newDocument(sheetSize, input.title);
  const layout = layoutAlbum({ ...input, albumLink: Boolean(input.albumUrl) }, measurer(doc));
  if (layout.cover && !coverPath) throw new Error("The profile has a separate cover");
  const tmp = mkdtempSync(join(tmpdir(), "sammelband-pdf-"));
  try {
    const images = await prepareImages(layout, input, tmp);
    const sheets = sheetsOf(layout.pages, spread, input.profile.firstPageRight);
    const total = sheets.length + (layout.cover ? 1 : 0);
    let done = 0;
    await writeDocument(doc, outPath, async () => {
      for (const sheet of sheets) {
        addSheet(doc, sheetSize, g.bleed);
        sheet.slots.forEach((page, i) => {
          if (!page) return;
          if (!spread) {
            renderPage(doc, g, page, images, input);
            return;
          }
          // Each page in its half, with the bleed only on the outside.
          doc.save();
          doc.rect(i === 0 ? 0 : g.bleed + g.width, 0, g.width + g.bleed, sheetSize[1]).clip();
          if (i === 1) doc.translate(g.width, 0);
          renderPage(doc, g, page, images, input);
          doc.restore();
        });
        await input.onProgress?.(0.85 + (0.15 * ++done) / total);
      }
    });
    if (layout.cover && coverPath) {
      await renderCoverSheet(layout.cover, images, input, coverPath);
      await input.onProgress?.(1);
    }
    return {
      pages: layout.pages.length,
      sheets: sheets.length,
      cover: Boolean(layout.cover),
      warnings: layout.warnings,
    };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Pipe a document to a file, draw it, and wait until it is written. */
async function writeDocument(doc: Doc, path: string, draw: () => Promise<void>): Promise<void> {
  const written = new Promise<void>((resolve, reject) => {
    const out = createWriteStream(path);
    out.on("finish", resolve);
    out.on("error", reject);
    doc.on("error", reject);
    doc.pipe(out);
  });
  await draw();
  doc.end();
  await written;
}

/**
 * The book pages on sheets: one each, or as spreads 1+2, 3+4, … (with page 1
 * alone on the right: [–, 1], [2, 3], …, the last one possibly alone on the left).
 */
function sheetsOf(pages: Page[], spread: boolean, firstPageRight: boolean): Sheet[] {
  if (!spread) return pages.map((page) => ({ slots: [page] }));
  const slots: (Page | null)[] = firstPageRight ? [null, ...pages] : [...pages];
  if (slots.length % 2 === 1) slots.push(null);
  const sheets: Sheet[] = [];
  for (let i = 0; i < slots.length; i += 2) {
    sheets.push({ slots: [slots[i] ?? null, slots[i + 1] ?? null] });
  }
  return sheets;
}

/** One book page, drawn as if it were a page of its own (the caller places it). */
function renderPage(
  doc: Doc,
  g: Geometry,
  page: Page,
  images: Map<string, string>,
  input: RenderInput,
): void {
  if (page.kind === "cover") renderCover(doc, g, page, images);
  else if (page.kind === "back") renderBack(doc, g, page, images, input.videos, input.albumUrl);
  else if (page.kind === "content") renderContent(doc, g, page, images, input.videos);
}

/**
 * The separate cover: back, spine and front side by side on one sheet, with
 * the bleed around it. The front photo stays on the front.
 */
async function renderCoverSheet(
  cover: CoverSheet,
  images: Map<string, string>,
  input: RenderInput,
  path: string,
): Promise<void> {
  const g = cover.geometry;
  const size: [number, number] = [2 * g.width + cover.spine + 2 * g.bleed, g.height + 2 * g.bleed];
  const doc = newDocument(size, input.title);
  await writeDocument(doc, path, async () => {
    addSheet(doc, size, g.bleed);
    // The back, on the left (its bleed on the left, top and bottom).
    doc.save();
    doc.rect(0, 0, g.bleed + g.width, size[1]).clip();
    renderBack(doc, g, cover.back, images, input.videos, input.albumUrl);
    doc.restore();
    // The spine.
    const spineX = g.bleed + g.width;
    doc.save();
    doc.rect(spineX, 0, cover.spine, size[1]).clip();
    renderSpine(doc, g, spineX, cover.spine, cover.front.title);
    doc.restore();
    // The front, on the right.
    doc.save();
    doc.rect(spineX + cover.spine, 0, g.width + g.bleed, size[1]).clip();
    doc.translate(g.width + cover.spine, 0);
    renderCover(doc, g, cover.front, images);
    doc.restore();
  });
}

/** The title along the spine, top to bottom, if the spine is wide enough for it. */
function renderSpine(doc: Doc, g: Geometry, x: number, width: number, title: Line[]): void {
  if (width < 6 * MM) return;
  const text = title
    .map((l) => l.spans.map((s) => s.text).join(""))
    .join(" ")
    .trim();
  if (!text) return;
  const room = g.height - 2 * Math.max(g.safe, 8 * MM);
  let size = Math.min(14, width * 0.5);
  doc.font("heading");
  while (size > 6 && doc.fontSize(size).widthOfString(text) > room) size -= 0.5;
  if (doc.fontSize(size).widthOfString(text) > room) return;
  const textWidth = doc.widthOfString(text);
  const lineHeight = doc.currentLineHeight(true);
  doc.save();
  // Rotated a quarter turn clockwise: the text runs down the spine.
  doc.translate(x + width / 2, g.bleed + g.height / 2).rotate(90);
  doc.fillColor(COLORS.text);
  doc.text(text, -textWidth / 2, -lineHeight / 2, { lineBreak: false });
  doc.restore();
}

/** Resized JPEGs of every photo in the layout, by photo id. */
async function prepareImages(
  layout: Layout,
  input: RenderInput,
  dir: string,
): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  const { dpi } = input.profile;
  const quality = dpi >= 300 ? 88 : 80;
  const entries = [...layout.photoSizes];
  for (const [i, [id, size]] of entries.entries()) {
    const width = Math.max(1, Math.ceil((size.w / 72) * dpi));
    const original = input.original(id);
    const bytes = await imageDecoding.run(() =>
      new Bun.Image(original)
        .resize(width, undefined, { withoutEnlargement: true })
        .jpeg({ quality })
        .bytes(),
    );
    const path = join(dir, `${i}.jpg`);
    await Bun.write(path, bytes);
    paths.set(id, path);
    await input.onProgress?.((0.85 * (i + 1)) / entries.length);
  }
  return paths;
}

/** The front: the cover photo edge to edge with the title, or the title on paper. */
function renderCover(
  doc: Doc,
  g: Geometry,
  page: Extract<Page, { kind: "cover" }>,
  images: Map<string, string>,
): void {
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

/**
 * The back: all the photos as a gallery, then the mark. Videos only get a
 * play mark here: their codes are on the pages before.
 */
function renderBack(
  doc: Doc,
  g: Geometry,
  page: Extract<Page, { kind: "back" }>,
  images: Map<string, string>,
  videos: Map<string, VideoMark> = new Map(),
  albumUrl?: string | null,
): void {
  for (const box of page.boxes) {
    drawPhoto(doc, g, box, images.get(box.id), videos.get(box.id), false);
  }
  if (page.code && albumUrl) {
    const { x, y, size } = page.code;
    drawLinkCode(doc, albumUrl, g.bleed + x, g.bleed + y, size);
  }
  if (page.markY === null) return;
  const logo = 22 * g.scale;
  const x = g.bleed + (g.width - logo) / 2;
  const y = g.bleed + page.markY;
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
}

/** A page of the description or the sections. */
function renderContent(
  doc: Doc,
  g: Geometry,
  page: Extract<Page, { kind: "content" }>,
  images: Map<string, string>,
  videos: Map<string, VideoMark> = new Map(),
): void {
  for (const box of page.boxes) {
    if (box.kind === "rect") {
      roundedPath(doc, g.bleed + box.x, g.bleed + box.y, box.w, box.h, box.radii).fill(box.fill);
    } else if (box.kind === "text") {
      drawLine(doc, g.bleed + box.x, g.bleed + box.y, box.line, box.width);
    } else {
      drawPhoto(doc, g, box, images.get(box.id), videos.get(box.id), true, page.side);
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

/** A sheet of the trimmed size plus the bleed around it, marked for the print shop. */
function addSheet(doc: Doc, [w, h]: [number, number], bleed: number): void {
  doc.addPage({ size: [w, h], margin: 0 });
  if (bleed <= 0) return;
  // PDF boxes are [left, bottom, right, top] from the bottom left.
  const data = doc.page.dictionary.data as Record<string, unknown>;
  data.TrimBox = [bleed, bleed, w - bleed, h - bleed];
  data.BleedBox = [0, 0, w, h];
}

/**
 * A photo in its box (cropped at the centre when `cover`), with its caption;
 * a video's poster also with its QR code.
 */
function drawPhoto(
  doc: Doc,
  g: Geometry,
  box: PhotoBox,
  image: string | undefined,
  video?: VideoMark,
  code = true,
  side?: Side,
): void {
  const x = g.bleed + box.x;
  const y = g.bleed + box.y;
  // Everything of the photo stays inside its rounded corners.
  doc.save();
  roundedPath(doc, x, y, box.w, box.h, box.radii).clip();
  if (image) {
    if (box.cover) {
      doc.image(image, x, y, { cover: [box.w, box.h], align: "center", valign: "center" });
    } else {
      doc.image(image, x, y, { width: box.w, height: box.h });
    }
  }
  const caption = box.caption;
  if (caption) {
    // A shade from above the caption down to the photo's bottom, so white text
    // reads on light photos too.
    const lineH = caption.lines.reduce((sum, l) => sum + l.height, 0);
    const top = g.bleed + caption.y - lineH * 1.6;
    const bottom = y + box.h;
    const shade = doc.linearGradient(0, top, 0, bottom);
    shade.stop(0, "#000000", 0).stop(0.45, "#000000", 0.45).stop(1, "#000000", 0.65);
    doc.rect(x, top, box.w, bottom - top).fill(shade);
  }
  doc.restore();
  if (video) {
    // Away from the trim (and the fold), like captions.
    const safe = safeArea(g, side);
    const bounds = {
      x: g.bleed + safe.left,
      y: g.bleed + safe.top,
      w: safe.right - safe.left,
      h: safe.bottom - safe.top,
    };
    drawVideoMark(doc, { x, y, w: box.w, h: box.h }, bounds, video, code);
  }
  if (!caption) return;
  let ly = g.bleed + caption.y;
  for (const line of caption.lines) {
    drawLine(doc, g.bleed + caption.x, ly, line, line.width, true);
    ly += line.height;
  }
}

/** A rectangle with its own radius at each corner (top left, top right, bottom right, bottom left). */
function roundedPath(doc: Doc, x: number, y: number, w: number, h: number, radii: Radii): Doc {
  const max = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radii.map((r) => Math.min(r, max)) as Radii;
  // Bézier handles for a quarter circle.
  const k = 0.5523;
  return doc
    .moveTo(x + tl, y)
    .lineTo(x + w - tr, y)
    .bezierCurveTo(x + w - tr + tr * k, y, x + w, y + tr - tr * k, x + w, y + tr)
    .lineTo(x + w, y + h - br)
    .bezierCurveTo(x + w, y + h - br + br * k, x + w - br + br * k, y + h, x + w - br, y + h)
    .lineTo(x + bl, y + h)
    .bezierCurveTo(x + bl - bl * k, y + h, x, y + h - bl + bl * k, x, y + h - bl)
    .lineTo(x, y + tl)
    .bezierCurveTo(x, y + tl - tl * k, x + tl - tl * k, y, x + tl, y)
    .closePath();
}

/**
 * One line of text at (x, y), its top; `width` is the space for centred lines
 * and rules. `halo` puts a thin dark outline under light text on photos.
 */
function drawLine(doc: Doc, x: number, y: number, line: Line, width: number, halo = false): void {
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
    if (halo) {
      doc.save();
      doc
        .lineWidth(line.size * 0.18)
        .strokeColor("#000000")
        .strokeOpacity(0.35)
        .lineJoin("round");
      doc.text(span.text, left + span.x, top, { lineBreak: false, stroke: true, fill: false });
      doc.restore();
    }
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
