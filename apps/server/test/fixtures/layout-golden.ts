import { createHash } from "node:crypto";
import type { Layout, LayoutPhoto, LayoutSection } from "../../src/services/pdf/layout";

// A fixed album for golden tests of the PDF layout: the same input always
// gives the same layout, so a hash of it shows that a refactoring changed
// nothing. Text widths come from a fake font (half the size per character).

export const goldenMeasure = (text: string, _font: string, size: number) =>
  text.length * size * 0.5;

const RATIOS = [1.5, 0.67, 1.5, 1.33, 1, 0.75, 1.78, 1.5, 0.67, 2.2];

function photos(prefix: string, count: number, caption: string | null = null): LayoutPhoto[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    ratio: RATIOS[(i * 7 + prefix.length) % RATIOS.length] ?? 1,
    caption,
  }));
}

const words = (count: number) => Array.from({ length: count }, (_, i) => `word${i}`).join(" ");

export function goldenAlbum(): {
  title: string;
  description: string;
  cover: LayoutPhoto;
  sections: LayoutSection[];
} {
  return {
    title: "Adrian's first year",
    description: `${words(60)}\n\n${words(40)}`,
    cover: { id: "cover", ratio: 1.5, caption: null },
    sections: [
      { title: "Arrival", text: words(80), highlight: false, photos: photos("a", 5, "On the way") },
      { title: "One moment", text: "", highlight: false, photos: photos("b", 1) },
      { title: "The hike", text: words(200), highlight: true, photos: photos("c", 9, "View") },
      {
        title: "Notes",
        text: "Short **text** with a [link](https://example.com).\n\n- one\n- two",
        highlight: false,
        photos: [],
      },
      { title: "", text: "", highlight: false, photos: photos("d", 13) },
      { title: "Goodbye", text: words(20), highlight: false, photos: photos("e", 7, "Bye") },
    ],
  };
}

/** A short, stable fingerprint of a layout (pages, boxes, photo sizes). */
export function layoutHash(layout: Pick<Layout, "pages" | "photoSizes">): string {
  const json = JSON.stringify({
    pages: layout.pages,
    photoSizes: [...layout.photoSizes.entries()].sort(([a], [b]) => a.localeCompare(b)),
  });
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}
