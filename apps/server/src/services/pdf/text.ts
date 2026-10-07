import type { FontKey } from "./theme";

// Line breaking for the PDF. The layout needs the height of every line before
// anything is drawn (to decide what fits on a page and to split text across
// pages), so lines are broken here, with the fonts' real widths, instead of
// by pdfkit while drawing.

/** Width of `text` in pt, set in `font` at `size`. */
export type Measure = (text: string, font: FontKey, size: number) => number;

export type Span = { text: string; font: FontKey; link?: string };

export type Paragraph = {
  spans: Span[];
  size: number;
  /** Line height in pt. */
  lineHeight: number;
  color: string;
  /** Space above the paragraph, in pt (dropped at the top of a page). */
  spaceBefore: number;
  /** Left indent in pt (lists, quotes). */
  indent?: number;
  /** Drawn left of the first line, inside the indent: "•", "1.". */
  marker?: string;
  /** A bar left of every line (block quotes). */
  quote?: boolean;
  align?: "left" | "center";
  /** A horizontal rule instead of text. */
  rule?: boolean;
};

export type LineSpan = { text: string; font: FontKey; link?: string; x: number };

export type Line = {
  spans: LineSpan[];
  /** Width of the text, without the indent. */
  width: number;
  size: number;
  height: number;
  color: string;
  indent: number;
  marker?: string;
  quote?: boolean;
  align: "left" | "center";
  rule?: boolean;
};

type Piece = { text: string; font: FontKey; link?: string; width: number };

/**
 * Break a paragraph into lines of at most `width` pt (minus its indent).
 * Spaces collapse; "\n" breaks the line; a word longer than a line is split.
 * With `maxLines`, the last line kept ends in "…" if text was cut.
 */
export function breakLines(
  p: Paragraph,
  width: number,
  measure: Measure,
  maxLines = Number.POSITIVE_INFINITY,
): Line[] {
  const indent = p.indent ?? 0;
  const base = { size: p.size, height: p.lineHeight, color: p.color, indent };
  const align = p.align ?? "left";
  if (p.rule) return [{ ...base, spans: [], width: 0, align, rule: true }];

  const avail = Math.max(width - indent, p.size);
  const w = (text: string, font: FontKey) => measure(text, font, p.size);
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  let lineWidth = 0;
  // The word being collected: pieces of adjacent spans without a space between.
  let word: Piece[] = [];
  let spaceBefore = false;
  let spaceFont: FontKey = p.spans[0]?.font ?? "body";

  const pushLine = () => {
    lines.push(line);
    line = [];
    lineWidth = 0;
  };
  const place = (piece: Piece) => {
    line.push(piece);
    lineWidth += piece.width;
  };
  const flushWord = () => {
    if (word.length === 0) return;
    const wordWidth = word.reduce((sum, x) => sum + x.width, 0);
    const space = line.length > 0 && spaceBefore ? w(" ", spaceFont) : 0;
    if (lineWidth + space + wordWidth <= avail) {
      if (space) place({ text: " ", font: spaceFont, width: space });
      for (const x of word) place(x);
    } else {
      if (line.length > 0) pushLine();
      for (const piece of word) {
        if (lineWidth + piece.width <= avail) {
          place(piece);
          continue;
        }
        // Longer than a line: split by characters.
        let chunk = "";
        for (const ch of piece.text) {
          const next = chunk + ch;
          if (lineWidth + w(next, piece.font) > avail && (chunk || line.length > 0)) {
            if (chunk) place({ ...piece, text: chunk, width: w(chunk, piece.font) });
            pushLine();
            chunk = ch;
          } else {
            chunk = next;
          }
        }
        if (chunk) place({ ...piece, text: chunk, width: w(chunk, piece.font) });
      }
    }
    word = [];
    spaceBefore = false;
  };

  for (const span of p.spans) {
    for (const part of span.text.split(/(\n|[^\S\n]+)/)) {
      if (part === "") continue;
      if (part === "\n") {
        flushWord();
        pushLine();
        spaceBefore = false;
      } else if (/^\s+$/.test(part)) {
        flushWord();
        spaceBefore = true;
        spaceFont = span.font;
      } else {
        word.push({ text: part, font: span.font, link: span.link, width: w(part, span.font) });
      }
    }
  }
  flushWord();
  if (line.length > 0 || lines.length === 0) pushLine();

  let kept = lines;
  if (lines.length > maxLines) {
    kept = lines.slice(0, maxLines);
    const last = kept[kept.length - 1] ?? [];
    kept[kept.length - 1] = withEllipsis(last, avail, w);
  }
  return kept.map((pieces, i) => {
    const spans = merge(pieces);
    return {
      ...base,
      spans,
      width: pieces.reduce((sum, x) => sum + x.width, 0),
      align,
      ...(i === 0 && p.marker && { marker: p.marker }),
      ...(p.quote && { quote: true }),
    };
  });
}

/** Cut a line so that it ends in "…" within `avail`. */
function withEllipsis(
  pieces: Piece[],
  avail: number,
  w: (text: string, font: FontKey) => number,
): Piece[] {
  const out = pieces.map((x) => ({ ...x }));
  const font = out.at(-1)?.font ?? "body";
  const dots = w("…", font);
  let total = out.reduce((sum, x) => sum + x.width, 0);
  while (out.length > 0 && total + dots > avail) {
    const last = out[out.length - 1] as Piece;
    const chars = [...last.text];
    chars.pop();
    if (chars.length === 0) {
      out.pop();
    } else {
      last.text = chars.join("");
      last.width = w(last.text, last.font);
    }
    total = out.reduce((sum, x) => sum + x.width, 0);
  }
  const last = out.at(-1);
  if (last) last.text = last.text.trimEnd();
  out.push({ text: "…", font, width: dots });
  return out;
}

/** Join neighbouring pieces in the same font and link, with their x offsets. */
function merge(pieces: Piece[]): LineSpan[] {
  const spans: LineSpan[] = [];
  let x = 0;
  for (const piece of pieces) {
    const prev = spans.at(-1);
    if (prev && prev.font === piece.font && prev.link === piece.link) {
      prev.text += piece.text;
    } else {
      spans.push({
        text: piece.text,
        font: piece.font,
        x,
        ...(piece.link && { link: piece.link }),
      });
    }
    x += piece.width;
  }
  return spans;
}
