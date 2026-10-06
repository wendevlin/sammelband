import { describe, expect, test } from "bun:test";
import { EXPORT_FORMATS, EXPORT_PURPOSES, PAGE_FORMATS, PURPOSES } from "@sammelband/shared";
import { placeTree, solveFor, treesOf } from "../src/services/pdf/collage";
import {
  type Box,
  type LayoutInput,
  type LayoutPhoto,
  type LayoutSection,
  layoutAlbum,
} from "../src/services/pdf/layout";
import { breakLines } from "../src/services/pdf/text";

// The PDF layout with a fake font: every character is half as wide as the font size.
const measure = (text: string, _font: string, size: number) => text.length * size * 0.5;

const RATIOS = [1.5, 0.67, 1.5, 1.33, 1, 0.75, 1.78, 1.5, 0.67, 2.2];
let n = 0;
const photos = (count: number, caption: string | null = null): LayoutPhoto[] =>
  Array.from({ length: count }, () => {
    const id = `p${n++}`;
    return { id, ratio: RATIOS[n % RATIOS.length] ?? 1, caption };
  });
const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(" ");

function album(sections: LayoutSection[], extra: Partial<LayoutInput> = {}): LayoutInput {
  return {
    title: "Summer",
    description: null,
    cover: null,
    sections,
    format: PAGE_FORMATS.a4,
    purpose: PURPOSES.home,
    captions: false,
    ...extra,
  };
}

const contentPages = (input: LayoutInput) =>
  layoutAlbum(input, measure).pages.flatMap((p) => (p.kind === "content" ? [p] : []));

const overlaps = (a: Box, b: Box) => {
  const h = (x: Box) => (x.kind === "text" ? x.line.height : x.h);
  const w = (x: Box) => (x.kind === "text" ? x.line.width : x.w);
  return a.x < b.x + w(b) && b.x < a.x + w(a) && a.y < b.y + h(b) && b.y < a.y + h(a);
};

describe("PDF layout", () => {
  const sections: LayoutSection[] = [
    { title: "Arrival", text: words(80), highlight: false, photos: photos(5, "On the way") },
    { title: "One moment", text: "", highlight: false, photos: photos(1) },
    { title: "The hike", text: words(200), highlight: true, photos: photos(9, "View") },
    {
      title: "Notes",
      text: "Short **text** with a [link](https://example.com).",
      highlight: false,
      photos: [],
    },
    { title: "Goodbye", text: words(20), highlight: false, photos: photos(14) },
  ];

  for (const format of EXPORT_FORMATS) {
    for (const purpose of EXPORT_PURPOSES) {
      test(`every photo once, in order, on the page, nothing overlapping (${format}, ${purpose})`, () => {
        const input = album(sections, {
          format: PAGE_FORMATS[format],
          purpose: PURPOSES[purpose],
          captions: true,
        });
        const layout = layoutAlbum(input, measure);
        const g = layout.geometry;
        // Photos and tinted tiles may run into the bleed edge to edge; text
        // and captions always keep their distance from the trim.
        const outer = g.edgeToEdge
          ? { x: -g.bleed, y: -g.bleed, w: g.width + 2 * g.bleed, h: g.height + 2 * g.bleed }
          : { x: g.x, y: g.y, w: g.w, h: g.h };
        const inside = (x: number, y: number, w: number, h: number, area: typeof outer) => {
          expect(x).toBeGreaterThanOrEqual(area.x - 0.01);
          expect(y).toBeGreaterThanOrEqual(area.y - 0.01);
          expect(x + w).toBeLessThanOrEqual(area.x + area.w + 0.5);
          expect(y + h).toBeLessThanOrEqual(area.y + area.h + 0.5);
        };
        const safe = g.edgeToEdge
          ? { x: g.safe, y: g.safe, w: g.width - 2 * g.safe, h: g.height - 2 * g.safe }
          : outer;
        const placed: string[] = [];
        for (const page of layout.pages) {
          if (page.kind !== "content") continue;
          for (const box of page.boxes) {
            if (box.kind === "text") {
              inside(box.x, box.y, box.line.width, box.line.height, safe);
              continue;
            }
            inside(box.x, box.y, box.w, box.h, outer);
            if (box.kind !== "photo") continue;
            placed.push(box.id);
            let y = box.caption?.y ?? 0;
            for (const line of box.caption?.lines ?? []) {
              inside(box.caption?.x ?? 0, y, line.width, line.height, safe);
              y += line.height;
            }
          }
          const tiles = page.boxes.filter((b) => b.kind !== "text");
          for (const [i, a] of tiles.entries()) {
            for (const b of tiles.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
          }
        }
        expect(placed).toEqual(sections.flatMap((s) => s.photos.map((p) => p.id)));
      });
    }
  }

  test("pages of only photos are filled to the edges", () => {
    for (const purpose of EXPORT_PURPOSES) {
      const layout = layoutAlbum(
        album([{ title: "", text: "", highlight: false, photos: photos(12) }], {
          purpose: PURPOSES[purpose],
          format: PAGE_FORMATS["a5-landscape"],
        }),
        measure,
      );
      const g = layout.geometry;
      const frame = g.edgeToEdge
        ? { x: -g.bleed, y: -g.bleed, w: g.width + 2 * g.bleed, h: g.height + 2 * g.bleed }
        : { x: g.x, y: g.y, w: g.w, h: g.h };
      for (const page of layout.pages) {
        if (page.kind !== "content") continue;
        const ph = page.boxes.filter((b) => b.kind === "photo");
        expect(Math.min(...ph.map((b) => b.x))).toBeCloseTo(frame.x, 1);
        expect(Math.min(...ph.map((b) => b.y))).toBeCloseTo(frame.y, 1);
        expect(Math.max(...ph.map((b) => b.x + b.w))).toBeCloseTo(frame.x + frame.w, 1);
        expect(Math.max(...ph.map((b) => b.y + b.h))).toBeCloseTo(frame.y + frame.h, 1);
        // Everything but the gaps is photo.
        const area = ph.reduce((s, b) => s + b.w * b.h, 0);
        expect(area / (frame.w * frame.h)).toBeGreaterThan(0.9);
      }
    }
  });

  test("text stays legible on small pages: at least 9.5 pt, at most ~68 characters a line", () => {
    const layout = layoutAlbum(
      album([{ title: "Long", text: words(400), highlight: false, photos: photos(4) }], {
        format: PAGE_FORMATS["a5-landscape"],
      }),
      measure,
    );
    const lines = layout.pages.flatMap((p) =>
      p.kind === "content" ? p.boxes.flatMap((b) => (b.kind === "text" ? [b.line] : [])) : [],
    );
    const body = lines.filter((l) => l.size < 15);
    expect(body.length).toBeGreaterThan(20);
    for (const line of body) {
      expect(line.size).toBeGreaterThanOrEqual(9.5);
      expect(line.width).toBeLessThanOrEqual(line.size * 34 + 0.01);
    }
    // The whole text is there, word by word.
    const text = body.map((l) => l.spans.map((s) => s.text).join("")).join(" ");
    expect(text.split(/\s+/)).toEqual(words(400).split(" "));
  });

  test("a printed book needs no blank pages; the photos take the room", () => {
    for (const count of [3, 4, 5, 6, 7, 8, 9, 10]) {
      const layout = layoutAlbum(
        album([{ title: "Trip", text: words(30), highlight: false, photos: photos(count) }], {
          purpose: PURPOSES.print,
          format: PAGE_FORMATS["a5-landscape"],
        }),
        measure,
      );
      expect(layout.pages.length % 2).toBe(0);
      expect(layout.pages.filter((p) => p.kind === "blank")).toHaveLength(0);
    }
  });

  test("a section's title is on a page with its first photo (unless its text goes on)", () => {
    const layout = layoutAlbum(album(sections), measure);
    // "The hike" has a long text that continues on the next page; "Notes" has no photos.
    for (const section of sections.filter((s) => s.title !== "Notes" && s.title !== "The hike")) {
      const page = layout.pages.find(
        (p) =>
          p.kind === "content" &&
          p.boxes.some(
            (b) => b.kind === "text" && b.line.spans.some((s) => s.text === section.title),
          ),
      );
      expect(
        page?.kind === "content" &&
          page.boxes.some((b) => b.kind === "photo" && b.id === section.photos[0]?.id),
      ).toBe(true);
    }
  });

  test("cover, description page, back", () => {
    const withDescription = layoutAlbum(
      album([{ title: "", text: "", highlight: false, photos: photos(3) }], {
        description: "For grandma.",
        cover: photos(1)[0] ?? null,
      }),
      measure,
    );
    const kinds = withDescription.pages.map((p) => p.kind);
    expect(kinds[0]).toBe("cover");
    expect(kinds.at(-1)).toBe("back");
    expect(kinds.length % 2).toBe(0);
    const description = withDescription.pages[1];
    expect(
      description?.kind === "content" && description.boxes.some((b) => b.kind === "photo"),
    ).toBe(false);

    const without = layoutAlbum(
      album([{ title: "", text: "", highlight: false, photos: photos(3) }]),
      measure,
    );
    const second = without.pages[1];
    expect(second?.kind === "content" && second.boxes.some((b) => b.kind === "photo")).toBe(true);
  });

  test("a highlighted section's text gets a tinted tile", () => {
    const pages = contentPages(
      album([{ title: "Highlight", text: words(60), highlight: true, photos: photos(3) }]),
    );
    expect(pages[0]?.boxes[0]?.kind).toBe("rect");
  });

  test("the back shows every photo as a small gallery above the mark", () => {
    const layout = layoutAlbum(album(sections), measure);
    const g = layout.geometry;
    const back = layout.pages.at(-1);
    if (back?.kind !== "back") throw new Error("no back");
    expect(back.boxes.map((b) => b.id)).toEqual(sections.flatMap((s) => s.photos.map((p) => p.id)));
    for (const [i, box] of back.boxes.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(g.x - 0.01);
      expect(box.x + box.w).toBeLessThanOrEqual(g.x + g.w + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(g.y - 0.01);
      expect(box.y + box.h).toBeLessThanOrEqual(back.markY);
      for (const other of back.boxes.slice(i + 1)) expect(overlaps(box, other)).toBe(false);
    }
  });

  test("corners: round outside with margins, square at the trim edge to edge, a little inside", () => {
    const only = [{ title: "", text: "", highlight: false, photos: photos(4) }];
    for (const purpose of ["home", "print"] as const) {
      const layout = layoutAlbum(album(only, { purpose: PURPOSES[purpose] }), measure);
      const g = layout.geometry;
      const page = layout.pages.find((p) => p.kind === "content");
      if (page?.kind !== "content") throw new Error("no page");
      const radii = page.boxes.flatMap((b) => (b.kind === "photo" ? b.radii : []));
      const outer = Math.max(...radii);
      const inner = Math.min(...radii.filter((r) => r > 0));
      expect(inner).toBeLessThan(outer + 0.01);
      if (g.edgeToEdge) {
        // Corners on the page edge are trimmed: square. The rest a little round.
        expect(radii.filter((r) => r === 0).length).toBeGreaterThanOrEqual(8);
        expect(outer).toBeLessThan(5);
      } else {
        // Exactly the collage's four outer corners are clearly round.
        expect(radii.filter((r) => r === outer)).toHaveLength(4);
        expect(outer).toBeGreaterThan(inner * 2);
      }
    }
  });

  test("the photos to resize are known, at their largest size", () => {
    const [cover] = photos(1);
    if (!cover) throw new Error("no photo");
    const layout = layoutAlbum(album(sections, { cover }), measure);
    const ids = [cover.id, ...sections.flatMap((s) => s.photos.map((p) => p.id))];
    expect(new Set(layout.photoSizes.keys())).toEqual(new Set(ids));
  });
});

describe("collages", () => {
  test("a solved tree fills its rectangle exactly", () => {
    const ratios = [1.5, 0.67, 1.33, 1, 0.75];
    const frame = { x: 10, y: 20, w: 500, h: 360 };
    let solved = 0;
    for (const tree of treesOf(ratios.length)) {
      const at = (x: number) => ratios.map((r) => r * x);
      const x = solveFor(tree, at, 4, frame.w, frame.h, 0.5, 2);
      if (x === null) continue;
      solved++;
      const rects = placeTree(tree, at(x), 4, frame);
      expect(rects).toHaveLength(ratios.length);
      for (const [i, r] of rects.entries()) {
        expect(r.w / r.h).toBeCloseTo((ratios[i] ?? 1) * x, 4);
      }
      expect(Math.min(...rects.map((r) => r.x))).toBeCloseTo(frame.x, 4);
      expect(Math.max(...rects.map((r) => r.x + r.w))).toBeCloseTo(frame.x + frame.w, 4);
      expect(Math.max(...rects.map((r) => r.y + r.h))).toBeCloseTo(frame.y + frame.h, 4);
    }
    expect(solved).toBeGreaterThan(5);
  });

  test("trees keep the tiles in order and come in every shape", () => {
    expect(treesOf(1)).toHaveLength(1);
    expect(treesOf(3)).toHaveLength(6);
    const leaves = (t: ReturnType<typeof treesOf>[number]): number[] =>
      "leaf" in t ? [t.leaf] : t.children.flatMap(leaves);
    for (const tree of treesOf(5)) expect(leaves(tree)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("PDF text", () => {
  const para = (text: string) => ({
    spans: [{ text, font: "body" as const }],
    size: 10,
    lineHeight: 14,
    color: "#000",
    spaceBefore: 0,
  });

  test("lines stay within the width and keep every word", () => {
    const text = words(40);
    const lines = breakLines(para(text), 120, measure);
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(120);
    expect(lines.map((l) => l.spans.map((s) => s.text).join("")).join(" ")).toBe(text);
  });

  test("captions are cut to two lines with an ellipsis", () => {
    const lines = breakLines(para(words(40)), 120, measure, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.spans.at(-1)?.text.endsWith("…")).toBe(true);
    expect(lines[1]?.width).toBeLessThanOrEqual(120);
  });

  test("an overlong word is split", () => {
    const lines = breakLines(para("x".repeat(100)), 100, measure);
    expect(lines.length).toBe(5);
  });
});
