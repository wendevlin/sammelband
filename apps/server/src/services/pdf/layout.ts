import type { PageFormat, PurposeSpec } from "@sammelband/shared";
import { placeTree, type Rect, solveFor, type Tree, treesOf } from "./collage";
import { markdownParagraphs, plainParagraphs } from "./markdown";
import { breakLines, type Line, type Measure, type Paragraph, type Span } from "./text";
import { COLORS } from "./theme";

// The photo book layout: which text and photos go on which page, and where.
// Pure (no pdfkit, no files): text widths come from `measure`, so tests can
// run it with a fake font. Units are pt, origin at the top left of the
// trimmed page (the renderer shifts everything by the bleed).
//
// Pages:
//  1. Cover: the cover photo edge to edge with the title on it.
//  2. The album description, if there is one.
//  3. The sections, as collages that fill every page completely (collage.ts):
//     each photo is a tile, and so is a section's title with its text. Tiles
//     sit side by side and on top of each other in any nesting that keeps
//     their order; the text tile takes the shape that makes the photos fit
//     exactly, and pages of only photos crop them a little. How many tiles go
//     on each page is decided for the whole book at once (fewer, larger
//     photos are better), and so that a printed book needs no blank pages.
//  4. The back.
//
// Print at home keeps margins around the collage. Edge to edge (print shop,
// screen), the collage covers the whole page into the bleed; text and
// captions still keep their distance from the edge. Lines of text stay short
// enough to read (34 em, ~68 characters), and type never gets smaller than
// 9.5 pt (captions 7 pt).

export const MM = 72 / 25.4;

export type LayoutPhoto = { id: string; ratio: number; caption: string | null };

export type LayoutSection = {
  title: string;
  /** Markdown. */
  text: string;
  highlight: boolean;
  photos: LayoutPhoto[];
};

export type LayoutInput = {
  title: string;
  description: string | null;
  cover: LayoutPhoto | null;
  sections: LayoutSection[];
  format: PageFormat;
  purpose: PurposeSpec;
  captions: boolean;
};

/** A line of text; `width` is its column (for rules and centred lines). */
export type TextBox = { kind: "text"; x: number; y: number; width: number; line: Line };
export type PhotoBox = {
  kind: "photo";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The photo fills the box, cropped at the centre (its ratio differs a little). */
  cover: boolean;
  /** Caption lines at (x, y), on the photo in white on a shade. */
  caption: { x: number; y: number; lines: Line[] } | null;
};
export type RectBox = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  radius: number;
};
export type Box = TextBox | PhotoBox | RectBox;

export type Page =
  | { kind: "cover"; photo: LayoutPhoto | null; title: Line[] }
  /** `number` is null edge to edge, where photos reach the bottom of the page. */
  | { kind: "content"; boxes: Box[]; number: number | null }
  | { kind: "blank" }
  | { kind: "back" };

export type Geometry = {
  /** Trimmed page size. */
  width: number;
  height: number;
  bleed: number;
  /** The collage covers the page into the bleed; see the header. */
  edgeToEdge: boolean;
  /** Distance from the trim edge that text and captions keep at least. */
  safe: number;
  /** Content area inside the margins. */
  x: number;
  y: number;
  w: number;
  h: number;
  margin: number;
  /** Type scale: 1 on A4, smaller on small pages. */
  scale: number;
  gap: number;
};

export type Layout = {
  geometry: Geometry;
  pages: Page[];
  /** Largest size (pt) each photo is drawn at, to resize images for. */
  photoSizes: Map<string, { w: number; h: number }>;
};

/** Tiles on a page at most. */
const MAX_TILES = 6;
/** Pages of only photos may crop them this much to fill the page. */
const MAX_CROP = 1.3;

export function geometry(format: PageFormat, purpose: PurposeSpec): Geometry {
  const width = format.width * MM;
  const height = format.height * MM;
  const short = Math.min(width, height);
  const margin = short * 0.08;
  return {
    width,
    height,
    bleed: purpose.bleedMm * MM,
    edgeToEdge: purpose.edgeToEdge,
    safe: Math.max(5 * MM, margin * 0.5),
    x: margin,
    y: margin,
    w: width - 2 * margin,
    h: height - 2 * margin,
    margin,
    scale: Math.min(1.05, Math.max(0.78, short / 595)),
    gap: Math.max(4, short * 0.011),
  };
}

/**
 * A type size: scaled with the page, but never below what reads well on paper
 * at arm's length (body text 9.5 pt, captions 7 pt).
 */
function sized(size: number, min: number, s: number, leading: number) {
  const pt = Math.max(size * s, min);
  return { size: pt, lineHeight: pt * leading };
}

/** Body text lines are at most this many ems wide (~68 characters). */
const MEASURE_EM = 34;

/** Font sizes and spacing for a page geometry. */
function typeStyles(g: Geometry) {
  const s = g.scale;
  const body = { ...sized(10, 9.5, s, 1.5), color: COLORS.text };
  return {
    body,
    description: { ...sized(12, 11, s, 1.55), color: COLORS.text },
    caption: sized(7.5, 7, s, 1.35),
    sectionTitle: sized(21, 16, s, 1.24),
    albumTitle: sized(32, 22, s, 1.2),
    coverTitle: sized(38, 26, s, 1.16),
    /** The widest a column of body text gets. */
    measure: body.size * MEASURE_EM,
    titleGap: 10 * s,
    sectionGap: 26 * s,
    /** Inside a highlighted text tile, and between text and photos edge to edge. */
    tilePad: 14 * s,
  };
}

type Styles = ReturnType<typeof typeStyles>;

// --- Tiles ---------------------------------------------------------------------

type PhotoTile = { kind: "photo"; photo: LayoutPhoto; section: number };
/** A section's title and text, or a part of a long text. */
type TextTile = { kind: "text"; section: number; paras: Paragraph[]; highlight: boolean };
type Tile = PhotoTile | TextTile;

type Placed = { tree: Tree; rects: Rect[]; crop: number; cost: number };

export function layoutAlbum(input: LayoutInput, measure: Measure): Layout {
  const g = geometry(input.format, input.purpose);
  const st = typeStyles(g);
  const photoSizes = new Map<string, { w: number; h: number }>();
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  // The area a page's collage fills: inside the margins, or edge to edge the
  // whole page including the bleed.
  const frame: Rect = g.edgeToEdge
    ? { x: -g.bleed, y: -g.bleed, w: g.width + 2 * g.bleed, h: g.height + 2 * g.bleed }
    : { x: g.x, y: g.y, w: g.w, h: g.h };

  // --- Text tiles ----------------------------------------------------------------

  const titlePara = (text: string): Paragraph => ({
    spans: [{ text, font: "heading" }],
    size: st.sectionTitle.size,
    lineHeight: st.sectionTitle.lineHeight,
    color: COLORS.text,
    spaceBefore: 0,
  });

  type Lines = { lines: { line: Line; y: number }[]; height: number };
  const linesCache = new Map<string, Lines>();
  /** A text tile's lines at a column width, with their offsets from its top. */
  const textLines = (tile: TextTile, tileIndex: number, width: number): Lines => {
    const key = `${tileIndex}|${Math.round(width)}`;
    const cached = linesCache.get(key);
    if (cached) return cached;
    const lines: Lines["lines"] = [];
    let y = 0;
    tile.paras.forEach((p, i) => {
      if (i > 0) y += p.spaceBefore;
      for (const line of breakLines(p, width, measure)) {
        lines.push({ line, y });
        y += line.height;
      }
    });
    const result = { lines, height: y };
    linesCache.set(key, result);
    return result;
  };

  /** Split paragraphs into parts no higher than `maxH` at `width`. */
  const chunk = (paras: Paragraph[], width: number, maxH: number): Paragraph[][] => {
    const parts: Paragraph[][] = [];
    let current: Paragraph[] = [];
    let used = 0;
    const flush = () => {
      if (current.length > 0) parts.push(current);
      current = [];
      used = 0;
    };
    const queue = [...paras];
    while (queue.length > 0) {
      const p = queue.shift() as Paragraph;
      const lines = breakLines(p, width, measure);
      const space = current.length > 0 ? p.spaceBefore : 0;
      const h = space + sum(lines.map((l) => l.height));
      if (used + h <= maxH) {
        current.push(p);
        used += h;
        continue;
      }
      // Take the lines that still fit; the rest of the paragraph goes on.
      const room = maxH - used - space;
      const fit = lines.findIndex((_, i) => sum(lines.slice(0, i + 1).map((l) => l.height)) > room);
      if (fit > 0) {
        current.push({ ...p, spans: spansOf(lines.slice(0, fit)) });
        queue.unshift({
          ...p,
          spans: spansOf(lines.slice(fit)),
          spaceBefore: 0,
          marker: undefined,
        });
      } else if (current.length === 0) {
        current.push(p);
      } else {
        queue.unshift(p);
      }
      flush();
    }
    flush();
    return parts;
  };

  // The tiles of all sections, in order.
  const tiles: Tile[] = [];
  const textWidth = Math.min(st.measure, frame.w * 0.6);
  input.sections.forEach((section, si) => {
    const title = section.title.trim();
    const body = section.text.trim() ? markdownParagraphs(section.text, st.body) : [];
    if (title || body.length > 0) {
      const paras = title
        ? [
            titlePara(title),
            ...body.map((p, i) => (i === 0 ? { ...p, spaceBefore: st.titleGap } : p)),
          ]
        : body;
      // A long text is cut into parts of about the same length that each fit
      // a tile of at most 60% of a page.
      const maxH = frame.h * 0.6 - 2 * st.tilePad;
      const total = sum(
        paras.map(
          (p, i) =>
            (i > 0 ? p.spaceBefore : 0) +
            sum(breakLines(p, textWidth, measure).map((l) => l.height)),
        ),
      );
      const parts = Math.ceil(total / maxH);
      const partH = Math.min(maxH, total / parts + st.body.lineHeight * 2);
      for (const part of chunk(paras, textWidth, partH)) {
        tiles.push({ kind: "text", section: si, paras: part, highlight: section.highlight });
      }
    }
    for (const photo of section.photos) tiles.push({ kind: "photo", photo, section: si });
  });

  // --- One page's collage --------------------------------------------------------

  /** Padding inside a text tile: more where it meets the edge of the page. */
  const paddingOf = (rect: Rect, tile: TextTile) => {
    const inner = tile.highlight || g.edgeToEdge ? st.tilePad : 0;
    // Edge to edge, text keeps 3/4 of the margin from the trim.
    const edge = g.edgeToEdge ? g.bleed + g.margin * 0.75 : inner;
    const atEdge = (a: number, b: number) => Math.abs(a - b) < 0.5;
    return {
      l: atEdge(rect.x, frame.x) ? edge : inner,
      r: atEdge(rect.x + rect.w, frame.x + frame.w) ? edge : inner,
      t: atEdge(rect.y, frame.y) ? edge : inner,
      b: atEdge(rect.y + rect.h, frame.y + frame.h) ? edge : inner,
    };
  };

  const shortSide = Math.min(frame.w, frame.h);
  const pageArea = frame.w * frame.h;

  /** The best collage of tiles [from, to) on one page, or null. */
  const collage = (from: number, to: number): Placed | null => {
    const page = tiles.slice(from, to);
    const hasText = page.some((t) => t.kind === "text");
    let best: Placed | null = null;
    for (const tree of treesOf(page.length)) {
      // With text, its tiles take the shape that makes the photos fit exactly;
      // without, the photos are cropped a little (all alike).
      const aspectsAt = (x: number) =>
        page.map((t) => (t.kind === "photo" ? t.photo.ratio * (hasText ? 1 : x) : x));
      const x = hasText
        ? solveFor(tree, aspectsAt, g.gap, frame.w, frame.h, 0.05, 20)
        : solveFor(tree, aspectsAt, g.gap, frame.w, frame.h, 1 / MAX_CROP, MAX_CROP);
      if (x === null) continue;
      const rects = placeTree(tree, aspectsAt(x), g.gap, frame);
      const crop = hasText ? 1 : x;
      let cost = 6 * Math.log(crop) ** 2;
      const areas: number[] = [];
      let feasible = true;
      page.forEach((t, i) => {
        const r = rects[i] as Rect;
        if (t.kind === "photo") {
          areas.push(Math.log(r.w * r.h));
          // Photos too small to see.
          cost += 8 * Math.max(0, 0.3 - Math.min(r.w, r.h) / shortSide);
          return;
        }
        const pad = paddingOf(r, t);
        const w = r.w - pad.l - pad.r;
        const h = r.h - pad.t - pad.b;
        if (w < st.body.size * 15) {
          feasible = false;
          return;
        }
        const need = textLines(t, from + i, Math.min(w, st.measure)).height;
        if (need > h) {
          feasible = false;
          return;
        }
        // A text tile should be about as large as its text: not much empty
        // space below it, and not much beside it (lines stop at 34 em).
        const empty = 1 - need / h;
        cost += 1.5 * empty * empty;
        cost += 1.5 * Math.max(0, 1 - st.measure / w);
        cost += 2 * Math.max(0, (r.w * r.h) / pageArea - 0.45);
      });
      if (!feasible) continue;
      if (areas.length > 1) {
        const mean = sum(areas) / areas.length;
        cost += (0.6 * sum(areas.map((a) => (a - mean) ** 2))) / areas.length;
      }
      if (!best || cost < best.cost) best = { tree, rects, crop, cost };
    }
    return best;
  };

  // --- Pages for the whole book --------------------------------------------------

  // How many tiles a page should hold: big photos, a few more on large pages.
  const ideal = Math.min(5, Math.max(2, 2.6 * Math.sqrt(pageArea / 186_000)));
  const segments = new Map<string, Placed | null>();
  const segment = (from: number, to: number) => {
    const key = `${from}|${to}`;
    if (!segments.has(key)) segments.set(key, collage(from, to));
    return segments.get(key) ?? null;
  };
  /** The cost of tiles [from, to) as one page; infinite when they can't be. */
  const pageCost = (from: number, to: number) => {
    // A title and text never end a page when its photos follow.
    const last = tiles[to - 1];
    const next = tiles[to];
    if (last?.kind === "text" && next?.kind === "photo" && next.section === last.section) {
      return Number.POSITIVE_INFINITY;
    }
    const placed = segment(from, to);
    if (!placed) return Number.POSITIVE_INFINITY;
    const page = tiles.slice(from, to);
    const weight = sum(page.map((t) => (t.kind === "photo" ? 1 : 0.7)));
    // A page is calmer with one section; a new one may still start on it.
    const sections = new Set(page.map((t) => t.section)).size;
    return placed.cost + (0.6 * (weight - ideal) ** 2) / ideal + 0.35 * (sections - 1);
  };

  // Text before the sections: the description, flowed over as many pages as it needs.
  const descriptionPages = describe();

  // Best split into pages, by dynamic programming over (tiles done, page count
  // even/odd): a printed book should end without a blank page.
  type Step = { cost: number; from: number; parity: number };
  const n = tiles.length;
  const best: Step[][] = Array.from({ length: n + 1 }, () => [
    { cost: Number.POSITIVE_INFINITY, from: -1, parity: -1 },
    { cost: Number.POSITIVE_INFINITY, from: -1, parity: -1 },
  ]);
  (best[0] as Step[])[0] = { cost: 0, from: -1, parity: -1 };
  for (let to = 1; to <= n; to++) {
    for (let from = Math.max(0, to - MAX_TILES); from < to; from++) {
      const c = pageCost(from, to);
      if (!Number.isFinite(c)) continue;
      for (const parity of [0, 1]) {
        const prev = best[from]?.[parity];
        if (!prev || !Number.isFinite(prev.cost)) continue;
        const next = best[to]?.[1 - parity];
        if (next && prev.cost + c < next.cost) {
          (best[to] as Step[])[1 - parity] = { cost: prev.cost + c, from, parity };
        }
      }
    }
  }
  // Cover + description + content + back: even when printed.
  const wanted = (descriptionPages.length + 2) % 2;
  const ends = best[n] as Step[];
  const costOf = (p: number) => ends[p]?.cost ?? Number.POSITIVE_INFINITY;
  let parity = wanted;
  if (!input.purpose.padPages || !Number.isFinite(costOf(wanted))) {
    parity = costOf(0) <= costOf(1) ? 0 : 1;
  }
  const breaks: [number, number][] = [];
  for (let to = n, p = parity; to > 0; ) {
    const step = best[to]?.[p];
    if (!step || step.from < 0) break;
    breaks.unshift([step.from, to]);
    to = step.from;
    p = step.parity;
  }

  const contentPages: { boxes: Box[]; number: boolean }[] = [
    ...descriptionPages.map((boxes) => ({ boxes, number: !g.edgeToEdge })),
    ...breaks.map(([from, to]) => ({ boxes: draw(from, to), number: !g.edgeToEdge })),
  ];

  /** The boxes of a collage page. */
  function draw(from: number, to: number): Box[] {
    const placed = segment(from, to);
    if (!placed) return [];
    const boxes: Box[] = [];
    tiles.slice(from, to).forEach((t, i) => {
      const r = placed.rects[i] as Rect;
      if (t.kind === "photo") {
        const box: PhotoBox = {
          kind: "photo",
          id: t.photo.id,
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          cover: Math.abs(placed.crop - 1) > 0.002,
          caption: null,
        };
        const caption = input.captions ? t.photo.caption?.trim() : "";
        if (caption) box.caption = overlayCaption(box, caption);
        boxes.push(box);
        // The size the image is drawn at: the box, or more when cropped to it.
        const drawnW = Math.max(r.w, r.h * t.photo.ratio);
        const size = photoSizes.get(t.photo.id);
        if (!size || size.w < drawnW) {
          photoSizes.set(t.photo.id, { w: drawnW, h: drawnW / t.photo.ratio });
        }
        return;
      }
      if (t.highlight) {
        boxes.push({
          kind: "rect",
          ...r,
          fill: COLORS.highlight,
          radius: g.edgeToEdge ? 0 : 8 * g.scale,
        });
      }
      const pad = paddingOf(r, t);
      const width = Math.min(r.w - pad.l - pad.r, st.measure);
      const text = textLines(t, from + i, width);
      // Spare room: the text sits a little above the middle of its tile.
      const spare = r.h - pad.t - pad.b - text.height;
      const top = r.y + pad.t + Math.max(0, spare) * 0.4;
      for (const { line, y } of text.lines) {
        boxes.push({ kind: "text", x: r.x + pad.l, y: top + y, width, line });
      }
    });
    // Tinted tiles first, so nothing is drawn under them.
    return [...boxes.filter((b) => b.kind === "rect"), ...boxes.filter((b) => b.kind !== "rect")];
  }

  /**
   * A caption on its photo, at the bottom left of the part of it that is
   * safely on the page (away from the trim), in white on a shade.
   */
  function overlayCaption(box: PhotoBox, text: string): PhotoBox["caption"] {
    const pad = 6 * g.scale;
    const left = Math.max(box.x, g.safe) + pad;
    const right = Math.min(box.x + box.w, g.width - g.safe) - pad;
    const bottom = Math.min(box.y + box.h, g.height - g.safe) - pad;
    if (right - left < 48) return null;
    const lines = breakLines(
      {
        spans: [{ text, font: "bodyItalic" }],
        size: st.caption.size,
        lineHeight: st.caption.lineHeight,
        color: COLORS.white,
        spaceBefore: 0,
      },
      right - left,
      measure,
      2,
    );
    const y = bottom - lines.length * st.caption.lineHeight;
    if (y < box.y + pad) return null;
    return { x: left, y, lines };
  }

  /** The description page(s): the album title, a rule and the text, set a little above the middle. */
  function describe(): Box[][] {
    if (!input.description?.trim()) return [];
    const width = Math.min(g.w, st.description.size * MEASURE_EM);
    const head = breakLines(
      {
        spans: [{ text: input.title, font: "heading" }],
        size: st.albumTitle.size,
        lineHeight: st.albumTitle.lineHeight,
        color: COLORS.text,
        spaceBefore: 0,
      },
      width,
      measure,
    );
    const body: { line: Line; space: number }[] = [];
    for (const p of plainParagraphs(input.description, st.description)) {
      for (const [i, line] of breakLines(p, width, measure).entries()) {
        body.push({ line, space: i === 0 ? p.spaceBefore : 0 });
      }
    }
    const gap = st.sectionGap * 0.6;
    const headH = sum(head.map((l) => l.height)) + 2 * gap + 2;
    const bodyH = sum(body.map((b) => b.space + b.line.height));
    const pages: Box[][] = [];
    let boxes: Box[] = [];
    let y = g.y + Math.max(g.h * 0.12, (g.h - headH - bodyH) * 0.4);
    for (const line of head) {
      boxes.push({ kind: "text", x: g.x, y, width, line });
      y += line.height;
    }
    y += gap;
    boxes.push({ kind: "text", x: g.x, y, width, line: ruleLine(st) });
    y += 2 + gap;
    for (const { line, space } of body) {
      if (y + space + line.height > g.y + g.h) {
        pages.push(boxes);
        boxes = [];
        y = g.y;
      } else {
        y += space;
      }
      boxes.push({ kind: "text", x: g.x, y, width, line });
      y += line.height;
    }
    pages.push(boxes);
    return pages;
  }

  // --- Assembling --------------------------------------------------------------

  const coverTitle = breakLines(
    {
      spans: [{ text: input.title, font: "heading" }],
      size: st.coverTitle.size,
      lineHeight: st.coverTitle.lineHeight,
      color: input.cover ? COLORS.white : COLORS.text,
      spaceBefore: 0,
      align: input.cover ? "left" : "center",
    },
    g.w,
    measure,
    4,
  );
  if (input.cover) {
    photoSizes.set(input.cover.id, coverSize(input.cover.ratio, g));
  }

  const out: Page[] = [{ kind: "cover", photo: input.cover, title: coverTitle }];
  for (const { boxes, number } of contentPages) {
    out.push({ kind: "content", boxes, number: number ? out.length + 1 : null });
  }
  if (input.purpose.padPages) {
    while ((out.length + 1) % input.format.pageMultiple !== 0) out.push({ kind: "blank" });
  }
  out.push({ kind: "back" });
  return { geometry: g, pages: out, photoSizes };
}

/** The spans of some lines as one run of text, for a paragraph split across tiles. */
function spansOf(lines: Line[]): Span[] {
  const spans: Span[] = [];
  lines.forEach((line, i) => {
    for (const s of line.spans)
      spans.push({ text: s.text, font: s.font, ...(s.link && { link: s.link }) });
    if (i < lines.length - 1) spans.push({ text: " ", font: "body" });
  });
  return spans;
}

/** A short burgundy rule under the album title. */
function ruleLine(st: Styles): Line {
  return {
    spans: [],
    width: 36 * (st.body.size / 10),
    size: st.body.size,
    height: 2,
    color: COLORS.primary,
    indent: 0,
    align: "left",
    rule: true,
  };
}

/** The cover photo covers the page including the bleed. */
function coverSize(ratio: number, g: Geometry): { w: number; h: number } {
  const w = g.width + 2 * g.bleed;
  const h = g.height + 2 * g.bleed;
  return ratio > w / h ? { w: h * ratio, h } : { w, h: w / ratio };
}
