import { describe, expect, test } from "bun:test";
import {
  EXPORT_FORMATS,
  EXPORT_PURPOSES,
  type ExportProfileSpec,
  formatProfileSpec,
  SAAL_LAYFLAT_275,
  spineWidthMm,
} from "@sammelband/shared";
import { placeTree, solveFor, treesOf } from "../src/services/pdf/collage";
import {
  type Box,
  type LayoutInput,
  type LayoutPhoto,
  type LayoutSection,
  layoutAlbum,
  MM,
} from "../src/services/pdf/layout";
import { breakLines } from "../src/services/pdf/text";
import { goldenAlbum, goldenMeasure, layoutHash } from "./fixtures/layout-golden";

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
    profile: formatProfileSpec("a4", "home"),
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

// Fingerprints (and page counts) of the golden album's layout as it was before
// print profiles: the built-in profiles must lay it out exactly the same.
const GOLDEN: Record<string, string> = {
  "home:a4": "39b299dcda6a6807 12",
  "home:a4+link": "63e69bff71b03599 12",
  "print:a4": "f6baf98fd99572f1 12",
  "print:a4+link": "52c4947f1d617125 12",
  "screen:a4": "c8e976ceef795ece 12",
  "screen:a4+link": "7be44140786c0305 12",
  "home:a4-landscape": "a97484539e92378f 14",
  "home:a4-landscape+link": "e941fd119bf50737 14",
  "print:a4-landscape": "ba889017132c82c5 12",
  "print:a4-landscape+link": "134b4c48bcfdc83e 12",
  "screen:a4-landscape": "7e378797f6c1b298 13",
  "screen:a4-landscape+link": "ccc3068d36e2e03b 13",
  "home:a5": "8c6eb546936a5016 16",
  "home:a5+link": "39c5e76ec239952f 16",
  "print:a5": "ab175abb9baa32ac 14",
  "print:a5+link": "da1f853f000c0450 14",
  "screen:a5": "7322712b4091973b 14",
  "screen:a5+link": "5b6b786570ba24f8 14",
  "home:a5-landscape": "2a9e2412bdd833f0 16",
  "home:a5-landscape+link": "118462913e2b3dfe 16",
  "print:a5-landscape": "a6cdc305b61c4bb6 14",
  "print:a5-landscape+link": "e99c5d1489aef361 14",
  "screen:a5-landscape": "53e0f3ca9c5e2ca0 15",
  "screen:a5-landscape+link": "c8f7b9866bad2550 15",
  "home:square-21": "bb6c7fb785609f8d 16",
  "home:square-21+link": "80cba0da38d34d60 16",
  "print:square-21": "157724264c3113fa 14",
  "print:square-21+link": "370b82bad96acffa 14",
  "screen:square-21": "68a802d062072b16 14",
  "screen:square-21+link": "a797f174d96ecc79 14",
  "home:letter": "1764bd9c26bcce8e 14",
  "home:letter+link": "d7906f107b830a08 14",
  "print:letter": "8263c8dce8905471 12",
  "print:letter+link": "3395c157a42d35e4 12",
  "screen:letter": "d14a9b0ac646f2f5 11",
  "screen:letter+link": "3cdc026c5d77b6e6 11",
};

describe("built-in profiles lay out exactly as before profiles", () => {
  for (const format of EXPORT_FORMATS) {
    for (const purpose of EXPORT_PURPOSES) {
      for (const link of [false, true]) {
        const key = `${purpose}:${format}${link ? "+link" : ""}`;
        test(key, () => {
          const layout = layoutAlbum(
            {
              ...goldenAlbum(),
              profile: formatProfileSpec(format, purpose),
              captions: true,
              albumLink: link,
            },
            goldenMeasure,
          );
          expect(`${layoutHash(layout)} ${layout.pages.length}`).toBe(GOLDEN[key] ?? "");
          expect(layout.cover).toBeNull();
        });
      }
    }
  }
});

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
          profile: formatProfileSpec(format, purpose),
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
          profile: formatProfileSpec("a5-landscape", purpose),
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
        profile: formatProfileSpec("a5-landscape", "home"),
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
          profile: formatProfileSpec("a5-landscape", "print"),
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
      expect(box.y + box.h).toBeLessThanOrEqual(back.markY ?? 0);
      for (const other of back.boxes.slice(i + 1)) expect(overlaps(box, other)).toBe(false);
    }
  });

  test("the album link: a QR code between the gallery and the mark", () => {
    const layout = layoutAlbum(album(sections, { albumLink: true }), measure);
    const g = layout.geometry;
    const back = layout.pages.at(-1);
    if (back?.kind !== "back" || !back.code) throw new Error("no code on the back");
    const { code } = back;
    expect(code.size).toBeGreaterThanOrEqual(20 * (72 / 25.4) - 0.01);
    expect(code.x + code.size / 2).toBeCloseTo(g.x + g.w / 2, 1);
    expect(code.y + code.size).toBeLessThanOrEqual(back.markY ?? 0);
    expect(back.boxes).toHaveLength(sections.flatMap((s) => s.photos).length);
    for (const box of back.boxes) expect(box.y + box.h).toBeLessThanOrEqual(code.y);

    const without = layoutAlbum(album(sections), measure).pages.at(-1);
    expect(without?.kind === "back" && without.code).toBeNull();
  });

  test("corners: round outside with margins, square at the trim edge to edge, a little inside", () => {
    const only = [{ title: "", text: "", highlight: false, photos: photos(4) }];
    for (const purpose of ["home", "print"] as const) {
      const layout = layoutAlbum(
        album(only, { profile: formatProfileSpec("a4", purpose) }),
        measure,
      );
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

describe("print profiles", () => {
  const spread: ExportProfileSpec = {
    ...SAAL_LAYFLAT_275,
    pages: { min: null, max: null, step: 2 },
  };
  const many = (count: number): LayoutSection[] => [
    { title: "Trip", text: words(30), highlight: false, photos: photos(count) },
  ];

  test("spreads: each page runs into the bleed only on the outside, never across the fold", () => {
    const layout = layoutAlbum(album(many(30), { profile: spread }), measure);
    const g = layout.geometry;
    const pages = layout.pages.flatMap((p) => (p.kind === "content" ? [p] : []));
    expect(pages.length).toBeGreaterThan(4);
    for (const [i, page] of pages.entries()) {
      // Page 1 on the left, then right, left, …
      expect(page.side).toBe(i % 2 === 0 ? "left" : "right");
      const tiles = page.boxes.filter((b) => b.kind !== "text");
      const left = Math.min(...tiles.map((b) => b.x));
      const right = Math.max(...tiles.map((b) => b.x + b.w));
      if (page.side === "left") {
        expect(left).toBeCloseTo(-g.bleed, 1);
        expect(right).toBeLessThanOrEqual(g.width + 0.5);
      } else {
        expect(left).toBeGreaterThanOrEqual(-0.01);
        expect(right).toBeCloseTo(g.width + g.bleed, 1);
      }
    }
  });

  test("a separate cover: no front or back among the pages, a spine that grows with them", () => {
    const layout = layoutAlbum(album(many(30), { profile: SAAL_LAYFLAT_275 }), measure);
    expect(layout.pages.some((p) => p.kind === "cover" || p.kind === "back")).toBe(false);
    if (!layout.cover) throw new Error("no cover");
    expect(layout.cover.front.kind).toBe("cover");
    expect(layout.cover.back.boxes).toHaveLength(30);
    // No logo in this profile.
    expect(layout.cover.back.markY).toBeNull();
    const spine = SAAL_LAYFLAT_275.cover.mode === "separate" ? SAAL_LAYFLAT_275.cover.spine : null;
    expect(layout.cover.spine).toBeCloseTo(
      spineWidthMm(spine ?? { fixedMm: 0 }, layout.pages.length) * MM,
      3,
    );
    expect(layout.cover.geometry.width).toBeCloseTo(275 * MM, 3);
  });

  test("the photos spread out to reach the minimum before blank pages fill it", () => {
    const profile = { ...SAAL_LAYFLAT_275, pages: { min: 12, max: 40, step: 2 } };
    const layout = layoutAlbum(album(many(30), { profile }), measure);
    expect(layout.pages.length).toBe(12);
    expect(layout.pages.filter((p) => p.kind === "blank")).toHaveLength(0);
    expect(layout.warnings.find((w) => w.code === "blank_pages")).toBeUndefined();

    // Five photos can't fill 12 pages: blank pages, and a warning.
    const short = layoutAlbum(album(many(5), { profile }), measure);
    expect(short.pages.length).toBe(12);
    const blanks = short.pages.filter((p) => p.kind === "blank").length;
    expect(blanks).toBeGreaterThan(0);
    expect(short.warnings).toContainEqual({ code: "blank_pages", params: { count: blanks } });
  });

  test("more pages than the profile allows fail", () => {
    const profile = { ...SAAL_LAYFLAT_275, pages: { min: null, max: 4, step: 2 } };
    expect(() => layoutAlbum(album(many(60), { profile }), measure)).toThrow("at most 4");
  });

  test("the page count keeps to the step, with the front and back counted", () => {
    const profile: ExportProfileSpec = {
      ...formatProfileSpec("a5-landscape", "print"),
      pages: { min: null, max: null, step: 4 },
    };
    for (const count of [3, 6, 9, 14]) {
      const layout = layoutAlbum(album(many(count), { profile }), measure);
      expect(layout.pages.length % 4).toBe(0);
      expect(layout.pages[0]?.kind).toBe("cover");
      expect(layout.pages.at(-1)?.kind).toBe("back");
    }
  });

  test("page 1 alone on the right: the sides follow", () => {
    const profile = { ...spread, firstPageRight: true };
    const pages = layoutAlbum(album(many(12), { profile }), measure).pages.flatMap((p) =>
      p.kind === "content" ? [p] : [],
    );
    for (const [i, page] of pages.entries()) {
      expect(page.side).toBe(i % 2 === 0 ? "right" : "left");
    }
  });

  test("a gutter keeps text and captions away from the fold", () => {
    const profile = { ...spread, gutterMm: 15 };
    const layout = layoutAlbum(
      album(
        [{ title: "Trip", text: words(200), highlight: false, photos: photos(12, "Caption") }],
        { profile, captions: true },
      ),
      measure,
    );
    const g = layout.geometry;
    for (const page of layout.pages) {
      if (page.kind !== "content") continue;
      for (const box of page.boxes) {
        const spans: [number, number][] =
          box.kind === "text"
            ? [[box.x, box.x + box.line.width]]
            : box.kind === "photo" && box.caption
              ? box.caption.lines.map((l) => [box.caption?.x ?? 0, (box.caption?.x ?? 0) + l.width])
              : [];
        for (const [from, to] of spans) {
          if (page.side === "left") expect(to).toBeLessThanOrEqual(g.width - g.gutter + 0.5);
          else expect(from).toBeGreaterThanOrEqual(g.gutter - 0.5);
        }
      }
    }
  });

  test("a landscape photo alone on a portrait page is cropped to fit, with a warning", () => {
    const layout = layoutAlbum(
      album(
        [
          {
            title: "",
            text: "",
            highlight: false,
            photos: [{ id: "wide", ratio: 2.2, caption: null }],
          },
        ],
        {
          profile: formatProfileSpec("a5", "screen"),
        },
      ),
      measure,
    );
    const photo = layout.pages
      .flatMap((p) => (p.kind === "content" ? p.boxes : []))
      .find((b) => b.kind === "photo");
    expect(photo?.kind === "photo" && photo.cover).toBe(true);
    expect(layout.warnings).toContainEqual({ code: "photos_cropped", params: { count: 1 } });
  });
});
