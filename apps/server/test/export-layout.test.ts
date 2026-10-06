import { describe, expect, test } from "bun:test";
import {
  EXPORT_FORMATS,
  EXPORT_PURPOSES,
  justifyBalanced,
  PAGE_FORMATS,
  PURPOSES,
} from "@sammelband/shared";
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
      test(`every photo once, in order, inside the page (${format}, ${purpose})`, () => {
        const input = album(sections, {
          format: PAGE_FORMATS[format],
          purpose: PURPOSES[purpose],
          captions: true,
        });
        const layout = layoutAlbum(input, measure);
        const g = layout.geometry;
        // Photos and tints may run into the bleed edge to edge; text never leaves the margins.
        const outer = g.edgeToEdge
          ? { x: -g.bleed, y: -g.bleed, w: g.width + 2 * g.bleed, h: g.height + 2 * g.bleed }
          : { x: g.x, y: g.y, w: g.w, h: g.h };
        const placed: string[] = [];
        for (const page of layout.pages) {
          if (page.kind !== "content") continue;
          for (const box of page.boxes) {
            const area = box.kind === "text" ? { x: g.x, y: g.y, w: g.w, h: g.h } : outer;
            const h = box.kind === "text" ? box.line.height : box.h;
            const w = box.kind === "text" ? box.line.width : box.w;
            expect(box.x).toBeGreaterThanOrEqual(area.x - 0.01);
            expect(box.y).toBeGreaterThanOrEqual(area.y - 0.01);
            expect(box.x + w).toBeLessThanOrEqual(area.x + area.w + 0.5);
            expect(box.y + h).toBeLessThanOrEqual(area.y + area.h + 0.5);
            if (box.kind === "photo") {
              placed.push(box.id);
              for (const line of box.caption?.lines ?? []) {
                expect(box.caption?.x ?? 0).toBeGreaterThanOrEqual(g.safe - 0.01);
                expect((box.caption?.x ?? 0) + line.width).toBeLessThanOrEqual(
                  g.width - g.safe + 0.5,
                );
              }
            }
          }
          const photosOnPage = page.boxes.filter((b) => b.kind === "photo");
          for (const [i, a] of photosOnPage.entries()) {
            for (const b of photosOnPage.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
          }
        }
        expect(placed).toEqual(sections.flatMap((s) => s.photos.map((p) => p.id)));
      });
    }
  }

  test("edge to edge, galleries reach both edges and photo pages fill the page", () => {
    const layout = layoutAlbum(
      album([{ title: "Many", text: words(30), highlight: false, photos: photos(30) }], {
        purpose: PURPOSES.print,
        format: PAGE_FORMATS["a5-landscape"],
      }),
      measure,
    );
    const g = layout.geometry;
    const content = layout.pages.flatMap((p) => (p.kind === "content" ? [p] : []));
    const full = content.filter((p) => p.number === null);
    expect(full.length).toBeGreaterThan(0);
    for (const page of content) {
      const ph = page.boxes.filter((b) => b.kind === "photo");
      expect(Math.min(...ph.map((b) => b.x))).toBeCloseTo(-g.bleed, 1);
      expect(Math.max(...ph.map((b) => b.x + b.w))).toBeCloseTo(g.width + g.bleed, 1);
    }
    const page = full[0];
    if (!page) throw new Error("no full page");
    const ph = page.boxes.filter((b) => b.kind === "photo");
    expect(Math.min(...ph.map((b) => b.y))).toBeLessThan(1);
    expect(Math.max(...ph.map((b) => b.y + b.h))).toBeGreaterThan(g.height - 1);
  });

  test("text stays legible on small pages: at least 9.5 pt, at most ~68 characters a line", () => {
    const layout = layoutAlbum(
      album([{ title: "Long", text: words(400), highlight: false, photos: [] }], {
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
  });

  test("only printed books get blank pages before the back", () => {
    const input = album([{ title: "", text: "", highlight: false, photos: photos(2) }]);
    const count = (purpose: (typeof EXPORT_PURPOSES)[number]) =>
      layoutAlbum({ ...input, purpose: PURPOSES[purpose] }, measure).pages.length;
    expect(count("home") % 2).toBe(0);
    expect(count("print") % 2).toBe(0);
    expect(count("screen")).toBe(3);
  });

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
