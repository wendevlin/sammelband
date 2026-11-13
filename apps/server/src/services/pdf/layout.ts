import {
  type ExportProfileSpec,
  type ExportWarning,
  justify,
  spineWidthMm,
} from "@sammelband/shared";
import { fail } from "../../lib/errors";
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
//  4. The back: every photo of the album as a small gallery, like the album
//     page in the app, above Sammelband's mark; with `albumLink`, a QR code
//     to the album between them.
//
// What the pages look like comes from the export profile (shared export.ts):
// their size, bleed, how many there may be (the page breaks are chosen to
// reach at least `min` pages with larger photos before blank pages are
// added), and where the cover and the back go: first and last page, on a
// separate cover sheet (back, spine, front), or nowhere. With spreads, the
// bleed is only on the outside of each page: a left page's collage runs into
// the bleed on the left, top and bottom and stops at the fold, a right
// page's the other way round.
//
// Like the app, photos have rounded corners: the four outer corners of a
// page's collage clearly, the corners between tiles just a little. Edge to
// edge, corners at the edge of the page stay square (they are trimmed off).
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
  profile: ExportProfileSpec;
  captions: boolean;
  /** Room on the back for a QR code to the album online. */
  albumLink?: boolean;
};

/** Corner radii in pt: top left, top right, bottom right, bottom left. */
export type Radii = [number, number, number, number];

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
  radii: Radii;
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
  radii: Radii;
};
export type Box = TextBox | PhotoBox | RectBox;

/** Which side of the fold a page is on (only set where it matters: spreads, a gutter). */
export type Side = "left" | "right";

export type Page =
  | { kind: "cover"; photo: LayoutPhoto | null; title: Line[] }
  /** `number` is null edge to edge, where photos reach the bottom of the page. */
  | { kind: "content"; boxes: Box[]; number: number | null; side?: Side }
  | { kind: "blank" }
  /**
   * The back: all photos small, above the mark (at `markY`, null without
   * it), and between them the square for the QR code to the album (`code`,
   * its side `size`).
   */
  | {
      kind: "back";
      boxes: PhotoBox[];
      markY: number | null;
      code: { x: number; y: number; size: number } | null;
    };

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
  /** Extra distance of text from the fold (pt). */
  gutter: number;
  /** Two pages per PDF page; the bleed only on the outside. */
  spread: boolean;
};

/**
 * A separate cover: one sheet with the back, the spine and the front side by
 * side. `geometry` is one panel (back or front) with the sheet's bleed.
 */
export type CoverSheet = {
  geometry: Geometry;
  /** Width of the spine (pt). */
  spine: number;
  front: Extract<Page, { kind: "cover" }>;
  back: Extract<Page, { kind: "back" }>;
};

export type Layout = {
  geometry: Geometry;
  /** The book pages in the (interior) PDF. */
  pages: Page[];
  cover: CoverSheet | null;
  /** Largest size (pt) each photo is drawn at, to resize images for. */
  photoSizes: Map<string, { w: number; h: number }>;
  warnings: ExportWarning[];
};

/** Tiles on a page at most. */
const MAX_TILES = 6;
/** Pages of only photos may crop them this much to fill the page. */
const MAX_CROP = 1.3;
/** Photos cropped more than this get a warning. */
const NOTICEABLE_CROP = 1.2;

/** The geometry of the profile's book pages. */
export function geometry(profile: ExportProfileSpec): Geometry {
  return pageGeometry(profile.pageWidthMm, profile.pageHeightMm, profile.bleedMm, profile);
}

/** One panel of a separate cover (back or front), with the sheet's bleed. */
export function coverGeometry(profile: ExportProfileSpec): Geometry | null {
  const { cover } = profile;
  if (cover.mode !== "separate") return null;
  return {
    ...pageGeometry(cover.panelWidthMm, cover.panelHeightMm, cover.bleedMm, profile),
    edgeToEdge: true,
    gutter: 0,
    spread: false,
  };
}

function pageGeometry(
  widthMm: number,
  heightMm: number,
  bleedMm: number,
  profile: ExportProfileSpec,
): Geometry {
  const width = widthMm * MM;
  const height = heightMm * MM;
  const short = Math.min(width, height);
  const margin = short * 0.08;
  return {
    width,
    height,
    bleed: bleedMm * MM,
    edgeToEdge: profile.edgeToEdge,
    safe: Math.max(5 * MM, margin * 0.5),
    x: margin,
    y: margin,
    w: width - 2 * margin,
    h: height - 2 * margin,
    margin,
    scale: Math.min(1.05, Math.max(0.78, short / 595)),
    gap: Math.max(4, short * 0.011),
    gutter: profile.gutterMm * MM,
    spread: profile.layout === "spread",
  };
}

/**
 * The side of the fold book page `n` (from 1) is on. Spreads pair pages 1+2,
 * 3+4, … (page 1 left), or 1 alone on the right; single pages are printed as
 * a book starts, page 1 on the right.
 */
export function sideOf(profile: ExportProfileSpec, n: number): Side {
  const firstRight = profile.layout === "single" || profile.firstPageRight;
  return (n % 2 === 1) === firstRight ? "right" : "left";
}

/**
 * The trimmed area safely away from the edges (and from the fold by the
 * gutter), for text, captions and QR codes.
 */
export function safeArea(g: Geometry, side?: Side | null) {
  return {
    left: g.safe + (side === "right" ? g.gutter : 0),
    top: g.safe,
    right: g.width - g.safe - (side === "left" ? g.gutter : 0),
    bottom: g.height - g.safe,
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
  const profile = input.profile;
  const g = geometry(profile);
  const st = typeStyles(g);
  const photoSizes = new Map<string, { w: number; h: number }>();
  const warnings: ExportWarning[] = [];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  /** Pages know their side where it changes their layout. */
  const sided = g.spread || g.gutter > 0;
  const pageSide = (n: number): Side | null => (sided ? sideOf(profile, n) : null);

  /**
   * The area a page's collage fills: inside the margins (and the gutter), or
   * edge to edge the whole page including the bleed; with spreads, the bleed
   * only on the outside. Both sides' frames have the same size.
   */
  const frameFor = (side: Side | null): Rect => {
    if (g.edgeToEdge) {
      if (g.spread && side) {
        return {
          x: side === "left" ? -g.bleed : 0,
          y: -g.bleed,
          w: g.width + g.bleed,
          h: g.height + 2 * g.bleed,
        };
      }
      return { x: -g.bleed, y: -g.bleed, w: g.width + 2 * g.bleed, h: g.height + 2 * g.bleed };
    }
    const inset = side ? g.gutter : 0;
    return { x: g.x + (side === "right" ? inset : 0), y: g.y, w: g.w - inset, h: g.h };
  };
  /** A frame of the right size, for what doesn't depend on the side. */
  const frame = frameFor(sided ? "left" : null);

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
  const paddingOf = (rect: Rect, tile: TextTile, side: Side | null) => {
    const f = frameFor(side);
    const inner = tile.highlight || g.edgeToEdge ? st.tilePad : 0;
    // Edge to edge, text keeps 3/4 of the margin from the trim, and the
    // gutter more from the fold (where a spread has no bleed).
    const edge = g.edgeToEdge ? g.bleed + g.margin * 0.75 : inner;
    const fold = g.edgeToEdge ? (g.spread ? 0 : g.bleed) + g.margin * 0.75 + g.gutter : inner;
    const atEdge = (a: number, b: number) => Math.abs(a - b) < 0.5;
    return {
      l: atEdge(rect.x, f.x) ? (side === "right" ? fold : edge) : inner,
      r: atEdge(rect.x + rect.w, f.x + f.w) ? (side === "left" ? fold : edge) : inner,
      t: atEdge(rect.y, f.y) ? edge : inner,
      b: atEdge(rect.y + rect.h, f.y + f.h) ? edge : inner,
    };
  };

  const outerRadius = 12 * g.scale;
  const innerRadius = 3 * g.scale;
  /**
   * Corners of a tile: round like the app's photos. A corner on the outside
   * of the collage is rounded clearly (with margins, at the collage's
   * corners) or not at all (edge to edge, at the edge of the page).
   */
  const radiiOf = (r: Rect, f: Rect = frame): Radii => {
    const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
    const left = near(r.x, f.x);
    const right = near(r.x + r.w, f.x + f.w);
    const top = near(r.y, f.y);
    const bottom = near(r.y + r.h, f.y + f.h);
    const corner = (vertical: boolean, horizontal: boolean) => {
      if (g.edgeToEdge) return vertical || horizontal ? 0 : innerRadius;
      return vertical && horizontal ? outerRadius : innerRadius;
    };
    return [corner(top, left), corner(top, right), corner(bottom, right), corner(bottom, left)];
  };

  const shortSide = Math.min(frame.w, frame.h);
  const pageArea = frame.w * frame.h;

  /** The best collage of tiles [from, to) on one page, or null. */
  const collage = (from: number, to: number, side: Side | null): Placed | null => {
    const frame = frameFor(side);
    const page = tiles.slice(from, to);
    const hasText = page.some((t) => t.kind === "text");
    let best: Placed | null = null;
    for (const tree of treesOf(page.length)) {
      // With text, its tiles take the shape that makes the photos fit exactly;
      // without, the photos are cropped a little (all alike).
      const aspectsAt = (x: number) =>
        page.map((t) => (t.kind === "photo" ? t.photo.ratio * (hasText ? 1 : x) : x));
      // A photo alone on a page always fits, cropped as much as it takes (a
      // landscape photo on a portrait page), but only when nothing else does.
      const alone = !hasText && page.length === 1;
      let x = hasText
        ? solveFor(tree, aspectsAt, g.gap, frame.w, frame.h, 0.05, 20)
        : solveFor(tree, aspectsAt, g.gap, frame.w, frame.h, 1 / MAX_CROP, MAX_CROP);
      let forced = false;
      if (x === null && alone) {
        x = solveFor(tree, aspectsAt, g.gap, frame.w, frame.h, 0.01, 100);
        forced = x !== null;
      }
      if (x === null) continue;
      const rects = placeTree(tree, aspectsAt(x), g.gap, frame);
      const crop = hasText ? 1 : x;
      let cost = 6 * Math.log(crop) ** 2 + (forced ? 20 : 0);
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
        const pad = paddingOf(r, t, side);
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
  const segment = (from: number, to: number, side: Side | null) => {
    const key = `${from}|${to}|${side}`;
    if (!segments.has(key)) segments.set(key, collage(from, to, side));
    return segments.get(key) ?? null;
  };
  /** The cost of tiles [from, to) as one page; infinite when they can't be. */
  const pageCost = (from: number, to: number, side: Side | null) => {
    // A title and text never end a page when its photos follow.
    const last = tiles[to - 1];
    const next = tiles[to];
    if (last?.kind === "text" && next?.kind === "photo" && next.section === last.section) {
      return Number.POSITIVE_INFINITY;
    }
    const placed = segment(from, to, side);
    if (!placed) return Number.POSITIVE_INFINITY;
    const page = tiles.slice(from, to);
    const weight = sum(page.map((t) => (t.kind === "photo" ? 1 : 0.7)));
    // A page is calmer with one section; a new one may still start on it.
    const sections = new Set(page.map((t) => t.section)).size;
    return placed.cost + (0.6 * (weight - ideal) ** 2) / ideal + 0.35 * (sections - 1);
  };

  // Text before the sections: the description, flowed over as many pages as it needs.
  const descriptionPages = describe();

  // Pages besides the collages: the front, the description, the back.
  const withCover = profile.cover.mode === "pages";
  const before = (withCover ? 1 : 0) + descriptionPages.length;
  const fixed = before + (withCover ? 1 : 0);
  const { min, max, step } = profile.pages;

  // Best split into pages, by dynamic programming over (tiles done, pages
  // used). Without a lower or upper limit, only the page count modulo the
  // step matters (a printed book should end without a blank page); with
  // limits, the count itself, so the photos spread over at least `min` pages
  // (larger) instead of blank pages filling the rest. With sides, the count's
  // parity also says which side the next page is on.
  const bounded = min !== null || max !== null;
  const n = tiles.length;
  const states = bounded
    ? Math.max(0, Math.min(n, (max ?? Number.POSITIVE_INFINITY) - fixed)) + 1
    : sided && step % 2 === 1
      ? step * 2
      : step;
  const nextState = (s: number) => (bounded ? s + 1 : (s + 1) % states);
  type Step = { cost: number; from: number; state: number };
  const best: Step[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: states }, () => ({ cost: Number.POSITIVE_INFINITY, from: -1, state: -1 })),
  );
  (best[0] as Step[])[0] = { cost: 0, from: -1, state: -1 };
  for (let to = 1; to <= n; to++) {
    for (let from = Math.max(0, to - MAX_TILES); from < to; from++) {
      for (let state = 0; state < states; state++) {
        const prev = best[from]?.[state];
        if (!prev || !Number.isFinite(prev.cost)) continue;
        const next = best[to]?.[nextState(state)];
        if (!next) continue;
        const c = pageCost(from, to, pageSide(before + state + 1));
        if (!Number.isFinite(c)) continue;
        if (prev.cost + c < next.cost) {
          (best[to] as Step[])[nextState(state)] = { cost: prev.cost + c, from, state };
        }
      }
    }
  }
  // Blank pages a book ending in this state needs, to reach `min` and the step.
  const blanksFor = (state: number) => {
    let total = fixed + state;
    const start = total;
    if (min !== null) total = Math.max(total, min);
    while (total % step !== 0) total++;
    return total - start;
  };
  const ends = best[n] as Step[];
  let end = -1;
  for (let state = 0; state < states; state++) {
    const cost = ends[state]?.cost ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(cost)) continue;
    const chosen = ends[end];
    if (
      !chosen ||
      blanksFor(state) < blanksFor(end) ||
      (blanksFor(state) === blanksFor(end) && cost < chosen.cost)
    ) {
      end = state;
    }
  }
  if (end < 0 && n > 0) {
    // Not even six tiles a page fit: more pages than the profile allows.
    throw fail("export_too_many_pages", { max: max ?? 0 });
  }
  const breaks: [number, number][] = [];
  for (let to = n, state = end; to > 0; ) {
    const step = best[to]?.[state];
    if (!step || step.from < 0) break;
    breaks.unshift([step.from, to]);
    to = step.from;
    state = step.state;
  }

  let cropped = 0;
  const contentPages: { boxes: Box[]; number: boolean; side: Side | null }[] = [
    ...descriptionPages.map((boxes, i) => {
      const side = pageSide(before - descriptionPages.length + i + 1);
      // The text is set for the narrower column; a right page moves it off the fold.
      const dx = side === "right" ? g.gutter : 0;
      const shifted = dx ? boxes.map((b) => ({ ...b, x: b.x + dx })) : boxes;
      return { boxes: shifted, number: !g.edgeToEdge, side };
    }),
    ...breaks.map(([from, to], i) => {
      const side = pageSide(before + i + 1);
      return { boxes: draw(from, to, side), number: !g.edgeToEdge, side };
    }),
  ];
  if (cropped > 0) warnings.push({ code: "photos_cropped", params: { count: cropped } });

  /** The boxes of a collage page. */
  function draw(from: number, to: number, side: Side | null): Box[] {
    const placed = segment(from, to, side);
    if (!placed) return [];
    const f = frameFor(side);
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
          radii: radiiOf(r, f),
          caption: null,
        };
        if (Math.max(placed.crop, 1 / placed.crop) > NOTICEABLE_CROP) cropped++;
        const caption = input.captions ? t.photo.caption?.trim() : "";
        if (caption) box.caption = overlayCaption(box, caption, side);
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
        boxes.push({ kind: "rect", ...r, fill: COLORS.highlight, radii: radiiOf(r, f) });
      }
      const pad = paddingOf(r, t, side);
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
  function overlayCaption(box: PhotoBox, text: string, side: Side | null): PhotoBox["caption"] {
    const pad = 6 * g.scale;
    const safe = safeArea(g, side);
    const left = Math.max(box.x, safe.left) + pad;
    const right = Math.min(box.x + box.w, safe.right) - pad;
    const bottom = Math.min(box.y + box.h, safe.bottom) - pad;
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
    const width = Math.min(g.w - (sided ? g.gutter : 0), st.description.size * MEASURE_EM);
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

  /** The front: the title on the cover photo, or on paper. */
  const front = (pg: Geometry): Extract<Page, { kind: "cover" }> => {
    const title = breakLines(
      {
        spans: [{ text: input.title, font: "heading" }],
        size: st.coverTitle.size,
        lineHeight: st.coverTitle.lineHeight,
        color: input.cover ? COLORS.white : COLORS.text,
        spaceBefore: 0,
        align: input.cover ? "left" : "center",
      },
      pg.w,
      measure,
      4,
    );
    if (input.cover) {
      const size = coverSize(input.cover.ratio, pg);
      const known = photoSizes.get(input.cover.id);
      if (!known || known.w < size.w) photoSizes.set(input.cover.id, size);
    }
    return { kind: "cover", photo: input.cover, title };
  };

  const out: Page[] = withCover ? [front(g)] : [];
  for (const { boxes, number, side } of contentPages) {
    out.push({
      kind: "content",
      boxes,
      number: number ? out.length + 1 : null,
      ...(side && { side }),
    });
  }
  const blanks = blanksFor(out.length - before);
  for (let i = 0; i < blanks; i++) out.push({ kind: "blank" });
  if (blanks > 0) warnings.unshift({ code: "blank_pages", params: { count: blanks } });
  if (withCover) out.push(back(g));
  if (max !== null && out.length > max) {
    throw fail("export_too_many_pages", { max });
  }

  let cover: CoverSheet | null = null;
  const pg = coverGeometry(profile);
  if (pg && profile.cover.mode === "separate") {
    cover = {
      geometry: pg,
      spine: spineWidthMm(profile.cover.spine, out.length) * MM,
      front: front(pg),
      back: back(pg),
    };
  }
  return { geometry: g, pages: out, cover, photoSizes, warnings };

  /**
   * The back: every photo in justified rows, like the album page, as large as
   * they fit above the mark. A last row that doesn't fill the width stays as
   * it is, as in the app.
   */
  function back(g: Geometry): Extract<Page, { kind: "back" }> {
    const mark = 22 * g.scale;
    // Without the mark, the gallery (and the code) take its room.
    const markY = profile.logo ? g.y + g.h - mark * 1.6 : null;
    const floor = markY ?? g.y + g.h;
    // The code's card: large enough for phone cameras at arm's length.
    const size = Math.min(26 * MM, Math.max(20 * MM, Math.min(g.w, g.h) * 0.14));
    const code = input.albumLink
      ? { x: g.x + (g.w - size) / 2, y: floor - (markY === null ? 0 : mark * 0.6) - size, size }
      : null;
    const bottom = code ? code.y : floor;
    const all = input.sections.flatMap((s) => s.photos);
    if (all.length === 0) {
      // Nothing above it: the code in the middle of the page.
      if (code) code.y = g.y + (bottom - g.y) / 2;
      return { kind: "back", boxes: [], markY, code };
    }
    const gap = Math.max(2.5, g.gap * 0.6);
    // Room above the code (or the mark), a little below it to breathe.
    const room = bottom - g.y - (code || markY !== null ? mark : 0);
    const ratios = all.map((p) => p.ratio);
    const heightOf = (rows: ReturnType<typeof justify>) =>
      sum(rows.map((r) => r.height)) + gap * (rows.length - 1);
    let target = room;
    let rows = justify(ratios, { width: g.w, targetHeight: target, gap });
    while (heightOf(rows) > room && target > 4) {
      target *= 0.96;
      rows = justify(ratios, { width: g.w, targetHeight: target, gap });
    }
    const boxes: PhotoBox[] = [];
    let y = g.y + Math.max(0, room - heightOf(rows)) / 2;
    const radius = Math.min(innerRadius, target / 8);
    for (const row of rows) {
      let x = g.x;
      for (const cell of row.items) {
        const photo = all[cell.index];
        if (!photo) continue;
        boxes.push({
          kind: "photo",
          id: photo.id,
          x,
          y,
          w: cell.width,
          h: cell.height,
          cover: false,
          radii: [radius, radius, radius, radius],
          caption: null,
        });
        if (!photoSizes.has(photo.id)) photoSizes.set(photo.id, { w: cell.width, h: cell.height });
        x += cell.width + gap;
      }
      y += row.height + gap;
    }
    return { kind: "back", boxes, markY, code };
  }
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
