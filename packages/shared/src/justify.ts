// Justified gallery rows, like Google Photos or Immich: photos keep their
// aspect ratio, every row has one height and fills the width exactly, except
// the last one, which isn't stretched.
// Shared by the album page and the PDF export; on paper, justifyBalanced()
// below picks the row breaks so that every row is complete.

export type JustifiedItem = { index: number; width: number; height: number };
export type JustifiedRow = { height: number; items: JustifiedItem[] };

export type JustifyOptions = {
  /** Available width, in whatever unit the result should use (px, mm). */
  width: number;
  /** Preferred row height; rows end up somewhat higher or lower. */
  targetHeight: number;
  /** Space between photos in a row, same unit. */
  gap: number;
};

/** How low a row may get (share of the target height) to take in the last photos. */
const MIN_MERGED_HEIGHT = 0.75;

/**
 * Split photos (given as width / height ratios, in order) into rows.
 * A row is closed before or after the photo that makes it overflow, whichever
 * gives a height closer to the target. Photos that don't fill a last row
 * join the row above when it stays at least 75% of the target height.
 * Invalid ratios count as square.
 */
export function justify(
  ratios: number[],
  { width, targetHeight, gap }: JustifyOptions,
): JustifiedRow[] {
  const rows: JustifiedRow[] = [];
  if (width <= 0 || targetHeight <= 0) return rows;
  const ar = ratios.map((r) => (Number.isFinite(r) && r > 0 ? r : 1));

  /** Height at which photos start..end (exclusive) fill the width exactly. */
  const fitHeight = (start: number, end: number) => {
    let sum = 0;
    for (let i = start; i < end; i++) sum += ar[i] ?? 1;
    return (width - gap * (end - start - 1)) / sum;
  };
  const row = (start: number, end: number, height: number): JustifiedRow => ({
    height,
    items: ar.slice(start, end).map((r, k) => ({ index: start + k, width: r * height, height })),
  });

  let start = 0;
  while (start < ar.length) {
    let end = start + 1;
    // Grow the row until it's at least as wide as the available width.
    while (end < ar.length && fitHeight(start, end) > targetHeight) end++;
    const fitted = fitHeight(start, end);
    if (fitted > targetHeight) {
      // The rest doesn't fill a row. Squeeze it into the row above if that
      // stays close enough to the target height (no lonely photo at the end),
      // else leave it unstretched: target height, no taller than the row above.
      const prev = rows.at(-1);
      const prevStart = prev?.items[0]?.index;
      if (prev && prevStart !== undefined) {
        const merged = fitHeight(prevStart, end);
        if (merged >= targetHeight * MIN_MERGED_HEIGHT) {
          rows[rows.length - 1] = row(prevStart, end, merged);
          break;
        }
      }
      rows.push(row(start, end, Math.min(targetHeight, prev?.height ?? targetHeight)));
      break;
    }
    // One photo fewer may come closer to the target height.
    if (end - start > 1) {
      const fewer = fitHeight(start, end - 1);
      if (Math.abs(fewer - targetHeight) < Math.abs(fitted - targetHeight)) {
        rows.push(row(start, end - 1, fewer));
        start = end - 1;
        continue;
      }
    }
    rows.push(row(start, end, fitted));
    start = end;
  }
  return rows;
}

/** How costly a last row that doesn't reach the right edge is (see justifyBalanced). */
const OPEN_ROW_COST = 0.6;
/** Rows of more photos than this aren't considered. */
const MAX_ROW_LENGTH = 8;
/** Complete rows may be at most this much higher than the target. */
const MAX_STRETCH = 1.8;

/**
 * Like justify(), but for a page: the row breaks are chosen together (as
 * Knuth–Plass breaks text into lines) so that every row fills the width and
 * the row heights stay as close to the target as possible. A last row that
 * stops short is allowed only when complete rows would be far off the target,
 * and rows never get much higher than it (a single portrait photo would
 * otherwise become a whole page high).
 */
export function justifyBalanced(
  ratios: number[],
  { width, targetHeight, gap }: JustifyOptions,
): JustifiedRow[] {
  const n = ratios.length;
  if (n === 0 || width <= 0 || targetHeight <= 0) return [];
  const ar = ratios.map((r) => (Number.isFinite(r) && r > 0 ? r : 1));
  const prefix = [0];
  for (const r of ar) prefix.push((prefix.at(-1) ?? 0) + r);
  const fitHeight = (start: number, end: number) =>
    (width - gap * (end - start - 1)) / ((prefix[end] ?? 0) - (prefix[start] ?? 0));
  // Rows lower than the target cost twice as much: small photos are the worse loss.
  const deviation = (h: number) => {
    const d = Math.log(h / targetHeight);
    return d < 0 ? 2 * d * d : d * d;
  };

  // best[i]: the lowest cost of laying out photos i..n-1, and where its first row ends.
  type Step = { cost: number; end: number; open: boolean };
  const best: Step[] = Array.from({ length: n + 1 }, () => ({
    cost: Number.POSITIVE_INFINITY,
    end: n,
    open: false,
  }));
  best[n] = { cost: 0, end: n, open: false };
  const costAt = (i: number) => best[i]?.cost ?? Number.POSITIVE_INFINITY;
  for (let i = n - 1; i >= 0; i--) {
    for (let end = i + 1; end <= Math.min(n, i + MAX_ROW_LENGTH); end++) {
      const h = fitHeight(i, end);
      if (h <= 0) break;
      const cost = deviation(h) + costAt(end);
      if (h <= targetHeight * MAX_STRETCH && cost < costAt(i)) best[i] = { cost, end, open: false };
      // The last photos as a row at the target height, short of the right edge.
      if (end === n && h > targetHeight && OPEN_ROW_COST < costAt(i)) {
        best[i] = { cost: OPEN_ROW_COST, end, open: true };
      }
    }
  }

  const rows: JustifiedRow[] = [];
  let start = 0;
  while (start < n) {
    const step = best[start] ?? { end: n, open: true };
    const height = step.open
      ? Math.min(targetHeight, rows.at(-1)?.height ?? targetHeight)
      : fitHeight(start, step.end);
    rows.push({
      height,
      items: ar
        .slice(start, step.end)
        .map((r, k) => ({ index: start + k, width: r * height, height })),
    });
    start = step.end;
  }
  return rows;
}
