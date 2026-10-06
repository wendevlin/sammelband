import { justify, justifyBalanced, type PageFormat } from "@sammelband/shared";
import { markdownParagraphs, plainParagraphs } from "./markdown";
import { breakLines, type Line, type Measure, type Paragraph } from "./text";
import { COLORS } from "./theme";

// The photo book layout: which text and photos go on which page, and where.
// Pure (no pdfkit, no files): text widths come from `measure`, so tests can
// run it with a fake font. Units are pt, origin at the top left of the
// trimmed page (the renderer shifts everything by the bleed).
//
// Pages:
//  1. Cover: the cover photo edge to edge with the title on it.
//  2. The album description, if there is one.
//  3. The sections: title, text, then the photos in justified rows (like the
//     album page, but balanced so that rows are complete: shared/justify.ts). A section starts on a page
//     only if its title, the start of its text and a row of photos fit there.
//     Before a page is closed, its photos grow to fill the space left (up to
//     1.6×); a few photos that would spill onto a new page are shrunk a bit
//     to stay instead.
//  4. Blank pages up to the format's page multiple, then the back.

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
  captions: boolean;
};

export type TextBox = { kind: "text"; x: number; y: number; line: Line };
export type PhotoBox = {
  kind: "photo";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Caption lines, starting at `y + h` plus the caption gap. */
  caption: Line[];
};
export type RectBox = {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  radius: number;
};
export type Box = TextBox | PhotoBox | RectBox;

export type Page =
  | { kind: "cover"; photo: LayoutPhoto | null; title: Line[] }
  | { kind: "content"; boxes: Box[]; number: number }
  | { kind: "blank" }
  | { kind: "back" };

export type Geometry = {
  /** Trimmed page size. */
  width: number;
  height: number;
  bleed: number;
  /** Content area. */
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

/** How much photos may grow to fill a page, and shrink to avoid a new one. */
const MAX_GROW = 1.6;
const MIN_SHRINK = 0.75;
/** A section's only photo may shrink further to stay with its title. */
const MIN_SHRINK_LONE = 0.55;
/** A lone photo takes at most this share of the content height. */
const LONE_PHOTO_SHARE = 0.72;
/** Lines of a section's text that must fit next to its title. */
const MIN_TEXT_LINES = 4;

export function geometry(format: PageFormat): Geometry {
  const width = format.width * MM;
  const height = format.height * MM;
  const short = Math.min(width, height);
  const margin = short * 0.08;
  return {
    width,
    height,
    bleed: format.bleed * MM,
    x: margin,
    y: margin,
    w: width - 2 * margin,
    h: height - 2 * margin,
    margin,
    scale: Math.min(1.05, Math.max(0.78, short / 595)),
    gap: Math.max(4, short * 0.011),
  };
}

/** Font sizes and spacing for a page geometry. */
function typeStyles(g: Geometry) {
  const s = g.scale;
  const body = { size: 10 * s, lineHeight: 15 * s, color: COLORS.text };
  return {
    body,
    description: { size: 12 * s, lineHeight: 18.5 * s, color: COLORS.text },
    caption: { size: 7.5 * s, lineHeight: 10 * s, color: COLORS.muted },
    sectionTitle: { size: 21 * s, lineHeight: 26 * s },
    albumTitle: { size: 32 * s, lineHeight: 38 * s },
    coverTitle: { size: 38 * s, lineHeight: 44 * s },
    sectionGap: 26 * s,
    titleGap: 10 * s,
    photoGap: 12 * s,
    captionGap: 3 * s,
    highlightPad: 14 * s,
  };
}

type Styles = ReturnType<typeof typeStyles>;

// --- Page items --------------------------------------------------------------

/** Vertical space; `flex` grows to fill a page, `keep` stays at the top of one. */
type Space = { kind: "space"; h: number; flex?: boolean; keep?: boolean; section?: number };
type LineItem = { kind: "line"; line: Line; section?: number; inset: number };
type PhotosItem = {
  kind: "photos";
  photos: LayoutPhoto[];
  /** Row height at scale 1. */
  target: number;
  width: number;
  section: number;
  inset: number;
};
type Item = Space | LineItem | PhotosItem;

/** How a gallery is drawn on its page: its scale, and balanced or greedy rows. */
type Fit = { f: number; greedy: boolean };

type Rows = { rows: ReturnType<typeof justifyBalanced>; captions: Line[][][]; heights: number[] };

export function layoutAlbum(input: LayoutInput, measure: Measure): Layout {
  const g = geometry(input.format);
  const st = typeStyles(g);
  const photoSizes = new Map<string, { w: number; h: number }>();

  // --- Photo rows ------------------------------------------------------------

  const captionPara = (text: string): Paragraph => ({
    spans: [{ text, font: "bodyItalic" }],
    size: st.caption.size,
    lineHeight: st.caption.lineHeight,
    color: st.caption.color,
    spaceBefore: 0,
  });

  const rowsCache = new Map<string, Rows>();
  /**
   * Justified rows of photos at a row height, with caption lines under each
   * photo. Balanced (complete rows) by default; `greedy` is the album page's
   * layout, whose last row may stop short: it fills heights balanced rows can't.
   */
  const rowsOf = (photos: LayoutPhoto[], width: number, target: number, greedy = false): Rows => {
    const key = `${photos.map((p) => p.id).join(",")}|${width.toFixed(2)}|${target.toFixed(2)}|${greedy}`;
    const cached = rowsCache.get(key);
    if (cached) return cached;
    const rows = (greedy ? justify : justifyBalanced)(
      photos.map((p) => p.ratio),
      { width, targetHeight: target, gap: g.gap },
    );
    const captions = rows.map((row) =>
      row.items.map((item) => {
        const caption = input.captions ? photos[item.index]?.caption?.trim() : "";
        return caption ? breakLines(captionPara(caption), item.width, measure, 2) : [];
      }),
    );
    const heights = rows.map((row, r) => {
      const lines = Math.max(0, ...(captions[r] ?? []).map((c) => c.length));
      return row.height + (lines > 0 ? st.captionGap + lines * st.caption.lineHeight : 0);
    });
    const result = { rows, captions, heights };
    rowsCache.set(key, result);
    return result;
  };
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const rowsHeight = (rows: Rows) =>
    sum(rows.heights) + g.gap * Math.max(0, rows.heights.length - 1);
  const photosHeight = (item: PhotosItem, scale: number, greedy = false) =>
    rowsHeight(rowsOf(item.photos, item.width, item.target * scale, greedy));

  /** How many rows, from the top, fit into `room`. */
  const rowsThatFit = (rows: Rows, room: number) => {
    let h = 0;
    let fit = 0;
    for (const rowH of rows.heights) {
      h += (fit > 0 ? g.gap : 0) + rowH;
      if (h > room + 0.01) break;
      fit++;
    }
    return fit;
  };
  const firstRows = (rows: Rows, n: number): Rows => ({
    rows: rows.rows.slice(0, n),
    captions: rows.captions.slice(0, n),
    heights: rows.heights.slice(0, n),
  });
  /** The largest scale down to MIN_SHRINK at which `ok` holds for the photos' rows. */
  const shrinkToFit = (item: PhotosItem, ok: (rows: Rows) => boolean) => {
    const min = item.photos.length === 1 ? MIN_SHRINK_LONE : MIN_SHRINK;
    for (let f = 0.97; f >= min - 0.001; f -= 0.03) {
      if (ok(rowsOf(item.photos, item.width, item.target * f))) return f;
    }
    return undefined;
  };

  /**
   * How many of a section's photos (from the start) to keep on a page with
   * `room` left, and at which scale: the choice that fills the room best with
   * complete rows. Undefined when nothing fills at least half of it.
   */
  const bestSplit = (item: PhotosItem, room: number) => {
    let best: { count: number; f: number; score: number } | undefined;
    for (let count = 1; count < item.photos.length; count++) {
      const part = { ...item, photos: item.photos.slice(0, count) };
      for (let f = MAX_GROW; f >= MIN_SHRINK - 0.001; f -= 0.03) {
        const h = photosHeight(part, f);
        if (h > room || openLastRow(part, f)) continue;
        // Fuller pages first, then more photos, then sizes near the natural one.
        const score = h / room + (0.03 * count) / item.photos.length - 0.03 * Math.abs(Math.log(f));
        if (!best || score > best.score) best = { count, f, score };
        break;
      }
    }
    return best && best.score >= 0.5 ? best : undefined;
  };

  /** Several rows of photos whose last row doesn't reach the right edge. */
  const openLastRow = (item: PhotosItem, scale: number, greedy = false) => {
    const { rows } = rowsOf(item.photos, item.width, item.target * scale, greedy);
    const last = rows.at(-1);
    if (rows.length < 2 || !last) return false;
    const width = sum(last.items.map((i) => i.width)) + g.gap * (last.items.length - 1);
    return width < item.width - 1;
  };

  /** The row height a section's photos start from. */
  const targetFor = (photos: LayoutPhoto[], width: number) => {
    if (photos.length === 1) {
      const ratio = photos[0]?.ratio ?? 1;
      return Math.min(g.h * 0.5, width / ratio);
    }
    return Math.min(g.h * 0.27, width / 2.6);
  };

  // --- Pagination --------------------------------------------------------------

  const pages: Item[][] = [];
  let items: Item[] = [];
  let used = 0;

  const itemHeight = (item: Item) =>
    item.kind === "space"
      ? item.h
      : item.kind === "line"
        ? item.line.height
        : photosHeight(item, 1);
  const add = (item: Item) => {
    items.push(item);
    used += itemHeight(item);
  };
  const remaining = () => g.h - used;
  /** Anything on the page besides spacing. */
  const hasContent = () => items.some((i) => i.kind !== "space");
  const newPage = () => {
    pages.push(items);
    items = [];
    used = 0;
  };

  /** Lines of paragraphs, with the space above each paragraph as its own item. */
  const textItems = (paras: Paragraph[], width: number, inset: number, section?: number) => {
    const out: Item[] = [];
    for (const p of paras) {
      if (out.length > 0 && p.spaceBefore > 0)
        out.push({ kind: "space", h: p.spaceBefore, section });
      for (const line of breakLines(p, width, measure)) {
        out.push({ kind: "line", line, section, inset });
      }
    }
    return out;
  };

  /**
   * Add text items, continuing on new pages. `bottom` is kept free (a
   * highlight's padding); `open` runs at the top of each new page.
   */
  const flowText = (list: Item[], bottom = 0, close?: () => void, open?: () => void) => {
    for (const item of list) {
      const h = itemHeight(item);
      if (item.kind === "space" && h > remaining() - bottom) continue;
      if (h > remaining() - bottom && hasContent()) {
        close?.();
        newPage();
        open?.();
        if (item.kind === "space") continue;
      }
      add(item);
    }
  };

  // Description page(s).
  if (input.description?.trim()) {
    const title = textItems(
      [
        {
          spans: [{ text: input.title, font: "heading" }],
          size: st.albumTitle.size,
          lineHeight: st.albumTitle.lineHeight,
          color: COLORS.text,
          spaceBefore: 0,
        },
      ],
      g.w,
      0,
    );
    const head: Item[] = [
      ...title,
      { kind: "space", h: st.sectionGap * 0.6, keep: true },
      { kind: "line", line: ruleLine(st), inset: 0 },
      { kind: "space", h: st.sectionGap * 0.6, keep: true },
    ];
    const body = textItems(plainParagraphs(input.description, st.description), g.w * 0.9, 0);
    // A short description sits a little above the middle of its page.
    const blockH = sum([...head, ...body].map(itemHeight));
    add({ kind: "space", h: Math.max(g.h * 0.12, (g.h - blockH) * 0.4), keep: true });
    for (const item of head) add(item);
    flowText(body);
    newPage();
  }
  const firstSectionPage = pages.length;

  input.sections.forEach((section, si) => {
    const pad = section.highlight ? st.highlightPad : 0;
    const width = g.w - 2 * pad;
    const title = section.title.trim()
      ? textItems(
          [
            {
              spans: [{ text: section.title.trim(), font: "heading" }],
              size: st.sectionTitle.size,
              lineHeight: st.sectionTitle.lineHeight,
              color: COLORS.text,
              spaceBefore: 0,
            },
          ],
          width,
          pad,
          si,
        )
      : [];
    const text = section.text.trim()
      ? textItems(markdownParagraphs(section.text, st.body), width, pad, si)
      : [];
    const photos = section.photos;
    if (title.length === 0 && text.length === 0 && photos.length === 0) return;
    const target = photos.length > 0 ? targetFor(photos, width) : 0;

    // Keep together: the title, the start of the text and a row of photos.
    const titleH =
      sum(title.map(itemHeight)) +
      (title.length && (text.length || photos.length) ? st.titleGap : 0);
    let textHead = 0;
    let lines = 0;
    for (const item of text) {
      if (lines >= MIN_TEXT_LINES) break;
      textHead += itemHeight(item);
      if (item.kind === "line") lines++;
    }
    const allText = lines < MIN_TEXT_LINES || textHead >= sum(text.map(itemHeight));
    const minShrink = photos.length === 1 ? MIN_SHRINK_LONE : MIN_SHRINK;
    const firstRow = photos.length
      ? (rowsOf(photos, width, target * minShrink).heights[0] ?? 0)
      : 0;
    const gapAbove = hasContent() ? st.sectionGap : 0;
    const need =
      gapAbove +
      2 * pad +
      titleH +
      textHead +
      (allText && photos.length ? (text.length ? st.photoGap : 0) + firstRow : 0);
    if (hasContent() && need > remaining()) newPage();
    else if (hasContent()) add({ kind: "space", h: st.sectionGap, flex: true });

    // A highlight's padding, at the top and bottom of every page it is on.
    const openChunk = () => {
      if (pad) add({ kind: "space", h: pad, section: si });
    };
    const closeChunk = () => {
      if (pad) add({ kind: "space", h: pad, section: si });
    };

    openChunk();
    for (const item of title) add(item);
    if (title.length && (text.length || photos.length)) {
      add({ kind: "space", h: st.titleGap, section: si });
    }
    flowText(text, pad, closeChunk, openChunk);
    if (text.length && photos.length) {
      if (st.photoGap <= remaining() - pad) add({ kind: "space", h: st.photoGap, section: si });
    }

    let rest = photos;
    while (rest.length > 0) {
      const room = remaining() - pad;
      const item: PhotosItem = {
        kind: "photos",
        photos: rest,
        target,
        width,
        section: si,
        inset: pad,
      };
      const rows = rowsOf(rest, width, target);
      const fit = rowsThatFit(rows, room);
      if (fit === rows.rows.length) {
        add(item);
        break;
      }
      // Only a little would spill over (or the first row is just too high):
      // shrink the photos so that all of them stay.
      const spill = rowsHeight(rows) - rowsHeight(firstRows(rows, fit));
      if (fit === 0 || spill < g.h * 0.3 || rows.rows.length - fit <= 1) {
        const f = shrinkToFit(item, (r) => rowsThatFit(r, room) === r.rows.length);
        if (f !== undefined) {
          items.push(item);
          used += photosHeight(item, f);
          break;
        }
      }
      // As many photos stay as fill the space left best (they may grow or
      // shrink a little for it); the rest moves on. If not even one row fits,
      // a smaller one may.
      let f = 1;
      let count = 0;
      const split = bestSplit({ ...item, photos: rest }, room);
      if (split) {
        ({ count, f } = split);
      } else if (fit > 0) {
        count = sum(rows.rows.slice(0, fit).map((r) => r.items.length));
      } else {
        const shrunk = shrinkToFit(item, (r) => rowsThatFit(r, room) > 0);
        if (shrunk !== undefined) {
          f = shrunk;
          const small = rowsOf(rest, width, target * f);
          count = sum(small.rows.slice(0, rowsThatFit(small, room)).map((r) => r.items.length));
        } else if (!hasContent()) {
          // An empty page: take a row anyway, the page scales it down.
          count = rows.rows[0]?.items.length ?? 1;
        }
      }
      if (count > 0) {
        const part = { ...item, photos: rest.slice(0, count) };
        items.push(part);
        used += photosHeight(part, f);
        rest = rest.slice(count);
      }
      closeChunk();
      newPage();
      openChunk();
    }
    closeChunk();
  });
  if (items.length > 0) newPage();

  // --- Placing ---------------------------------------------------------------

  const contentPages = pages.map((pageItems, i) =>
    place(pageItems, {
      fill: i >= firstSectionPage,
      last: i === pages.length - 1,
    }),
  );

  function place(list: Item[], opts: { fill: boolean; last: boolean }): Box[] {
    // No spacing at the top or bottom of a page, except a highlight's padding.
    const loose = (i: Item | undefined) =>
      i?.kind === "space" && i.section === undefined && !i.keep;
    const trimmed = [...list];
    while (loose(trimmed[0])) trimmed.shift();
    while (loose(trimmed.at(-1))) trimmed.pop();

    const groups = trimmed.filter((i): i is PhotosItem => i.kind === "photos");
    const fixed = sum(trimmed.filter((i) => i.kind !== "photos").map(itemHeight));
    const scales = chooseScales(groups, g.h - fixed, opts);
    const photosTotal = sum(
      groups.map((gr, i) => photosHeight(gr, scales[i]?.f ?? 1, scales[i]?.greedy)),
    );

    // Space still left goes between the sections, so the page looks set, not cut off.
    const flex = trimmed.filter((i): i is Space => i.kind === "space" && !!i.flex);
    const left = g.h - fixed - photosTotal;
    const extra =
      opts.fill && !opts.last && flex.length > 0 && left > 0
        ? Math.min(left / flex.length, st.sectionGap * 2)
        : 0;

    const boxes: Box[] = [];
    const sectionSpan = new Map<number, { top: number; bottom: number }>();
    let y = g.y;
    for (const item of trimmed) {
      const top = y;
      if (item.kind === "space") {
        y += item.h + (item.flex ? extra : 0);
      } else if (item.kind === "line") {
        boxes.push({ kind: "text", x: g.x + item.inset, y, line: item.line });
        y += item.line.height;
      } else {
        const fit = scales[groups.indexOf(item)] ?? { f: 1, greedy: false };
        const rows = rowsOf(item.photos, item.width, item.target * fit.f, fit.greedy);
        rows.rows.forEach((row, r) => {
          let x = g.x + item.inset;
          row.items.forEach((cell, c) => {
            const photo = item.photos[cell.index];
            if (!photo) return;
            boxes.push({
              kind: "photo",
              id: photo.id,
              x,
              y,
              w: cell.width,
              h: cell.height,
              caption: rows.captions[r]?.[c] ?? [],
            });
            const size = photoSizes.get(photo.id);
            if (!size || size.w < cell.width)
              photoSizes.set(photo.id, { w: cell.width, h: cell.height });
            x += cell.width + g.gap;
          });
          y += (rows.heights[r] ?? 0) + (r < rows.rows.length - 1 ? g.gap : 0);
        });
      }
      if (item.section !== undefined) {
        const span = sectionSpan.get(item.section);
        sectionSpan.set(item.section, { top: span ? span.top : top, bottom: y });
      }
    }

    // Highlighted sections: a tinted box behind their part of the page.
    const backgrounds: Box[] = [];
    for (const [si, span] of sectionSpan) {
      if (!input.sections[si]?.highlight) continue;
      backgrounds.push({
        kind: "rect",
        x: g.x,
        y: span.top,
        w: g.w,
        h: span.bottom - span.top,
        fill: COLORS.highlight,
        stroke: COLORS.highlightBorder,
        radius: 8 * g.scale,
      });
    }
    return [...backgrounds, ...boxes];
  }

  /**
   * A scale for each gallery on a page so that together they fill the space
   * best: as full a page as possible, complete rows (a gallery whose last
   * row stops halfway looks unfinished on paper), sizes near their natural
   * ones. Rows are complete, so a gallery's height changes in steps: each
   * gets a few candidates, and the best combination wins.
   */
  function chooseScales(groups: PhotosItem[], room: number, opts: { fill: boolean }): Fit[] {
    if (groups.length === 0) return [];
    type Candidate = Fit & { h: number; open: boolean };
    const candidates = groups.map((gr) => {
      let max = opts.fill ? MAX_GROW : 1;
      if (gr.photos.length === 1) max = Math.min(max, (g.h * LONE_PHOTO_SHARE) / gr.target);
      const list: Candidate[] = [];
      const seen = new Set<string>();
      for (const greedy of [false, true]) {
        for (let f = Math.max(max, 1); f >= 0.3; f -= 0.02) {
          const h = photosHeight(gr, f, greedy);
          const open = openLastRow(gr, f, greedy);
          const key = `${h.toFixed(1)}|${open}`;
          if (seen.has(key)) continue;
          seen.add(key);
          list.push({ f, greedy, h, open });
        }
      }
      return list;
    });

    const pick = (minScale: number) => {
      let best: Candidate[] | undefined;
      let bestScore = Number.NEGATIVE_INFINITY;
      const options = candidates.map((list, i) => {
        const min = Math.min(minScale, (groups[i]?.photos.length ?? 0) === 1 ? MIN_SHRINK_LONE : 1);
        return list.filter((c) => c.f >= min - 0.001);
      });
      if (options.some((o) => o.length === 0)) return undefined;
      const combos = options.reduce((n, o) => n * o.length, 1);
      if (combos > 50_000) return undefined;
      const chosen: Candidate[] = [];
      const walk = (i: number, height: number) => {
        if (height > room + 0.01) return;
        if (i === options.length) {
          const open = chosen.filter((c) => c.open).length;
          const drift = sum(chosen.map((c) => Math.abs(Math.log(c.f))));
          const score = height / g.h - 0.12 * open - (0.04 * drift) / chosen.length;
          if (score > bestScore) {
            bestScore = score;
            best = [...chosen];
          }
          return;
        }
        for (const c of options[i] ?? []) {
          chosen.push(c);
          walk(i + 1, height + c.h);
          chosen.pop();
        }
      };
      walk(0, 0);
      return best?.map(({ f, greedy }) => ({ f, greedy }));
    };

    // Shrink below MIN_SHRINK only when nothing else fits.
    const uniform = (min: number) => {
      for (let f = 1; f >= min; f -= 0.02) {
        if (sum(groups.map((gr) => photosHeight(gr, f))) <= room + 0.01) {
          return groups.map(() => ({ f, greedy: false }));
        }
      }
      return undefined;
    };
    return (
      pick(MIN_SHRINK) ?? pick(0.3) ?? uniform(0.3) ?? groups.map(() => ({ f: 0.3, greedy: false }))
    );
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
  for (const boxes of contentPages) {
    out.push({ kind: "content", boxes, number: out.length + 1 });
  }
  while ((out.length + 1) % input.format.pageMultiple !== 0) out.push({ kind: "blank" });
  out.push({ kind: "back" });
  return { geometry: g, pages: out, photoSizes };
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
