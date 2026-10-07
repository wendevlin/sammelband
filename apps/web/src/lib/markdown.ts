import { MARKED_OPTIONS } from "@sammelband/shared";
import { Marked, type Token } from "marked";

// Section text is Markdown. The editor (Tiptap's markdown extension), the album
// page and the PDF export parse it with marked and the same options (shared),
// so all read it alike. The page renders the tokens as Svelte elements, never
// as HTML strings.

export { MARKED_OPTIONS, safeHref } from "@sammelband/shared";

const parser = new Marked(MARKED_OPTIONS);

export function lex(markdown: string): Token[] {
  return parser.lexer(markdown);
}
