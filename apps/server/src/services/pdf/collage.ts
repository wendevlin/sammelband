// Collages that fill a rectangle exactly. A layout is a tree: a leaf is a
// tile (a photo or a block of text), an inner node puts its children side by
// side ("h", one height) or on top of each other ("v", one width), with a gap
// between them. For a given tree and tile aspect ratios, the width of the
// whole is an affine function of its height (w = p·h + q, the gaps make q), so
// it's cheap to work out how high the collage is at a given width and where
// every tile goes. Trees are tried in all shapes that keep the tiles' order.
//
// Like "blocked recursive image composition" (Atkins, HP Labs 2008).

export type Tree = { leaf: number } | { dir: "h" | "v"; children: Tree[] };

export type Rect = { x: number; y: number; w: number; h: number };

type Relation = { p: number; q: number };

/** w = p·h + q of a (sub)tree, for tile aspect ratios (width / height). */
export function relation(tree: Tree, aspects: number[], gap: number): Relation {
  if ("leaf" in tree) return { p: aspects[tree.leaf] ?? 1, q: 0 };
  const parts = tree.children.map((c) => relation(c, aspects, gap));
  const gaps = gap * (parts.length - 1);
  if (tree.dir === "h") {
    // Same height h: widths add up.
    return {
      p: parts.reduce((s, r) => s + r.p, 0),
      q: parts.reduce((s, r) => s + r.q, 0) + gaps,
    };
  }
  // Same width w: each child is (w − q)/p high, and the heights add up.
  const inv = parts.reduce((s, r) => s + 1 / r.p, 0);
  const off = parts.reduce((s, r) => s + r.q / r.p, 0);
  const p = 1 / inv;
  return { p, q: (off - gaps) * p };
}

/** Where each tile goes when the tree fills `rect` (its ratio must match). */
export function placeTree(
  tree: Tree,
  aspects: number[],
  gap: number,
  rect: Rect,
  out: Rect[] = [],
): Rect[] {
  if ("leaf" in tree) {
    out[tree.leaf] = rect;
    return out;
  }
  let offset = 0;
  for (const child of tree.children) {
    const r = relation(child, aspects, gap);
    if (tree.dir === "h") {
      const w = r.p * rect.h + r.q;
      placeTree(child, aspects, gap, { x: rect.x + offset, y: rect.y, w, h: rect.h }, out);
      offset += w + gap;
    } else {
      const h = (rect.w - r.q) / r.p;
      placeTree(child, aspects, gap, { x: rect.x, y: rect.y + offset, w: rect.w, h }, out);
      offset += h + gap;
    }
  }
  return out;
}

const shapes = new Map<string, Tree[]>();

/**
 * Every tree over `n` tiles in order: each inner node splits its run of tiles
 * into two or more consecutive groups, and alternates direction with its
 * parent (side by side inside side by side would be the same as one node).
 */
export function treesOf(n: number): Tree[] {
  return rooted(0, n, "h").concat(n > 1 ? rooted(0, n, "v") : []);
}

function rooted(start: number, n: number, dir: "h" | "v"): Tree[] {
  if (n === 1) return [{ leaf: start }];
  const key = `${start}|${n}|${dir}`;
  const cached = shapes.get(key);
  if (cached) return cached;
  const other = dir === "h" ? "v" : "h";
  const out: Tree[] = [];
  // Split [start, start+n) into consecutive groups (at least two).
  const groups = (from: number, left: number): number[][] => {
    if (left === 0) return [[]];
    const result: number[][] = [];
    for (let size = 1; size <= left; size++) {
      for (const rest of groups(from + size, left - size)) result.push([size, ...rest]);
    }
    return result;
  };
  for (const sizes of groups(start, n)) {
    if (sizes.length < 2) continue;
    let options: Tree[][] = [[]];
    let at = start;
    for (const size of sizes) {
      const subtrees = size === 1 ? [{ leaf: at } as Tree] : rooted(at, size, other);
      options = options.flatMap((prefix) => subtrees.map((t) => [...prefix, t]));
      at += size;
    }
    for (const children of options) out.push({ dir, children });
  }
  shapes.set(key, out);
  return out;
}

/**
 * The value of `x` in [lo, hi] at which the tree, with aspects `aspectsAt(x)`,
 * fills a `w`×`h` box exactly, or null. Its width at height h must grow with x.
 */
export function solveFor(
  tree: Tree,
  aspectsAt: (x: number) => number[],
  gap: number,
  w: number,
  h: number,
  lo: number,
  hi: number,
): number | null {
  const widthAt = (x: number) => {
    const r = relation(tree, aspectsAt(x), gap);
    return r.p * h + r.q;
  };
  if (widthAt(lo) > w || widthAt(hi) < w) return null;
  // Bisection on a log scale: x is a ratio.
  let a = Math.log(lo);
  let b = Math.log(hi);
  for (let i = 0; i < 40; i++) {
    const mid = (a + b) / 2;
    if (widthAt(Math.exp(mid)) < w) a = mid;
    else b = mid;
  }
  return Math.exp((a + b) / 2);
}
