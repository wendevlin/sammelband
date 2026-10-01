import { Marked, type Token } from "marked";

// Section text is Markdown. The editor (Tiptap's markdown extension) and the
// album page parse it with marked and the same options, so both read it alike.
// The page renders the tokens as Svelte elements, never as HTML strings.

/** GFM with single line breaks kept, as people type them. */
export const MARKED_OPTIONS = { gfm: true, breaks: true } as const;

const parser = new Marked(MARKED_OPTIONS);

export function lex(markdown: string): Token[] {
  return parser.lexer(markdown);
}

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
