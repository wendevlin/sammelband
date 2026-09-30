// Justified gallery rows, like Google Photos or Immich: photos keep their
// aspect ratio, every row has one height and fills the width exactly, except
// the last one, which isn't stretched.
// Shared so the album page and a later PDF export lay photos out the same way.

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
