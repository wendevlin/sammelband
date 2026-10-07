// Section text is Markdown. The editor, the album page and the PDF export
// parse it with marked and these options, so all of them read it alike.

// This package has no DOM or Bun types; URL exists in both runtimes.
declare const URL: new (href: string, base: string) => { origin: string; protocol: string };

/** GFM with single line breaks kept, as people type them. */
export const MARKED_OPTIONS = { gfm: true, breaks: true } as const;

/** Links only to the web, mail and phone; anything else (javascript:, data:) renders as text. */
export function safeHref(href: string): string | null {
  try {
    const url = new URL(href, "https://invalid.example");
    if (url.origin === "https://invalid.example") return null; // relative
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}
