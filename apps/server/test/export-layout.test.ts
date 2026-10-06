import { describe, expect, test } from "bun:test";
import { justifyBalanced, PAGE_FORMATS } from "@sammelband/shared";
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

  for (const format of ["a4", "a4-landscape", "a5", "square-21", "letter"] as const) {
    test(`every photo once, in order, inside the page (${format})`, () => {
      const input = album(sections, { format: PAGE_FORMATS[format], captions: true });
      const layout = layoutAlbum(input, measure);
      const g = layout.geometry;
      const placed: string[] = [];
      for (const page of layout.pages) {
        if (page.kind !== "content") continue;
        const boxes = page.boxes.filter((b) => b.kind !== "rect");
        for (const box of boxes) {
          const h = box.kind === "text" ? box.line.height : box.h;
          const w = box.kind === "text" ? box.line.width : box.w;
          expect(box.x).toBeGreaterThanOrEqual(g.x - 0.01);
          expect(box.y).toBeGreaterThanOrEqual(g.y - 0.01);
          expect(box.x + w).toBeLessThanOrEqual(g.x + g.w + 0.5);
          expect(box.y + h).toBeLessThanOrEqual(g.y + g.h + 0.5);
          if (box.kind === "photo") placed.push(box.id);
        }
        const photosOnPage = boxes.filter((b) => b.kind === "photo");
        for (const [i, a] of photosOnPage.entries()) {
          for (const b of photosOnPage.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
        }
      }
      expect(placed).toEqual(sections.flatMap((s) => s.photos.map((p) => p.id)));
    });
  }

  test("a section title never ends a page", () => {
    for (const page of contentPages(album(sections))) {
      const last = page.boxes.filter((b) => b.kind !== "rect").at(-1);
      expect(last?.kind === "text" && last.line.size > 15).toBe(false);
    }
  });

  test("photos grow to fill a page that is closed early", () => {
    const input = album([
      { title: "First", text: words(30), highlight: false, photos: photos(6) },
      { title: "Second", text: words(300), highlight: false, photos: [] },
    ]);
    const layout = layoutAlbum(input, measure);
    const first = layout.pages.find((p) => p.kind === "content");
    if (first?.kind !== "content") throw new Error("no content page");
    const g = layout.geometry;
    const bottom = Math.max(
      ...first.boxes.map((b) => (b.kind === "text" ? b.y + b.line.height : b.y + b.h)),
    );
    // Without growing, six photos in rows of ~27% of the page end far above.
    expect(bottom).toBeGreaterThan(g.y + g.h * 0.75);
  });

  test("cover, description page, even page count, back", () => {
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
    expect(without.pages.length % 2).toBe(0);
  });

  test("a highlighted section gets a box around its part of every page", () => {
    const pages = contentPages(
      album([{ title: "Highlight", text: words(600), highlight: true, photos: photos(4) }]),
    );
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(page.boxes[0]?.kind).toBe("rect");
  });

  test("the photos to resize are known, at their largest size", () => {
    const [cover] = photos(1);
    if (!cover) throw new Error("no photo");
    const layout = layoutAlbum(album(sections, { cover }), measure);
    const ids = [cover.id, ...sections.flatMap((s) => s.photos.map((p) => p.id))];
    expect(new Set(layout.photoSizes.keys())).toEqual(new Set(ids));
  });
});

describe("balanced rows", () => {
  test("every row fills the width when possible", () => {
    const rows = justifyBalanced([1.5, 0.67, 1.5, 1.33, 1], {
      width: 500,
      targetHeight: 180,
      gap: 6,
    });
    for (const row of rows) {
      const w = row.items.reduce((s, i) => s + i.width, 0) + 6 * (row.items.length - 1);
      expect(w).toBeCloseTo(500, 3);
    }
  });

  test("a single portrait photo isn't stretched to the full width", () => {
    const [row] = justifyBalanced([0.67], { width: 500, targetHeight: 200, gap: 6 });
    expect(row?.height).toBe(200);
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
