import { MARKED_OPTIONS } from "@sammelband/shared";
import { Marked, type Token, type Tokens } from "marked";

// Section text is Markdown. The editor (Tiptap's markdown extension), the album
// page and the PDF export parse it with marked and the same options (shared),
// so all read it alike. The page renders the tokens as Svelte elements, never
// as HTML strings.

export { MARKED_OPTIONS, safeHref } from "@sammelband/shared";

const parser = new Marked(MARKED_OPTIONS);

export function lex(markdown: string): Token[] {
  return parser.lexer(markdown);
}

/** Some Markdown's words without formatting, on one line (for previews). */
export function plainText(markdown: string): string {
  const words: string[] = [];
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === "list") walk((t as Tokens.List).items);
      else if ("tokens" in t && t.tokens?.length) walk(t.tokens);
      else if ("text" in t && typeof t.text === "string") words.push(t.text);
    }
  };
  walk(lex(markdown));
  return words.join(" ").replace(/\s+/g, " ").trim();
}
