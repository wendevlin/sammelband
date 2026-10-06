import { MARKED_OPTIONS, safeHref } from "@sammelband/shared";
import { Marked, type Token, type Tokens } from "marked";
import type { Paragraph, Span } from "./text";
import { bodyFont, COLORS } from "./theme";

// Section text (Markdown) as paragraphs for the PDF: the same parser and
// options as the album page, and the same rules (links only to the web, mail
// and phone; raw HTML stays text).

const parser = new Marked(MARKED_OPTIONS);

export type TextStyle = { size: number; lineHeight: number; color: string };

type Ctx = { indent: number; quote: boolean; marker?: string };

export function markdownParagraphs(markdown: string, style: TextStyle): Paragraph[] {
  const out: Paragraph[] = [];
  const listIndent = style.size * 1.6;

  const para = (spans: Span[], ctx: Ctx, extra: Partial<Paragraph> = {}) => {
    if (spans.every((s) => !s.text.trim()) && !extra.rule) return;
    out.push({
      spans,
      size: style.size,
      lineHeight: style.lineHeight,
      color: ctx.quote ? COLORS.muted : style.color,
      spaceBefore: out.length === 0 ? 0 : style.size * 0.75,
      ...(ctx.indent && { indent: ctx.indent }),
      ...(ctx.quote && { quote: true }),
      ...(ctx.marker && { marker: ctx.marker }),
      ...extra,
    });
    // A list item's marker goes on its first paragraph only.
    ctx.marker = undefined;
  };

  const blocks = (tokens: Token[], ctx: Ctx) => {
    for (const t of tokens) {
      switch (t.type) {
        case "paragraph":
          para(inline(children(t), false, false), ctx);
          break;
        case "heading":
          para(inline(children(t), true, false), ctx, {
            size: style.size * 1.15,
            lineHeight: style.lineHeight * 1.15,
            spaceBefore: out.length === 0 ? 0 : style.size * 1.2,
          });
          break;
        case "list": {
          const list = t as Tokens.List;
          const start = typeof list.start === "number" ? list.start : 1;
          list.items.forEach((item, i) => {
            const marker = list.ordered ? `${start + i}.` : "•";
            const itemCtx: Ctx = { indent: ctx.indent + listIndent, quote: ctx.quote, marker };
            const before = out.length;
            blocks(item.tokens, itemCtx);
            // Items of a tight list sit closer together.
            const first = out[before];
            if (first && i > 0 && !list.loose) first.spaceBefore = style.size * 0.25;
          });
          break;
        }
        case "blockquote":
          blocks(children(t), { indent: ctx.indent + style.size, quote: true });
          break;
        case "code":
          para([{ text: (t as Tokens.Code).text, font: "body" }], ctx);
          break;
        case "hr":
          para([], ctx, { rule: true, spaceBefore: style.size });
          break;
        case "text":
          // Text directly in a tight list item.
          para(
            children(t).length > 0 ? inline(children(t), false, false) : [plain(t, false, false)],
            ctx,
          );
          break;
        case "space":
          break;
        default:
          para([{ text: t.raw, font: "body" }], ctx);
      }
    }
  };

  blocks(parser.lexer(markdown), { indent: 0, quote: false });
  return out;
}

function children(t: Token): Token[] {
  return ("tokens" in t && t.tokens) || [];
}

function plain(t: Token, bold: boolean, italic: boolean, link?: string): Span {
  const text = "text" in t && typeof t.text === "string" ? t.text : t.raw;
  return { text, font: bodyFont(bold, italic), ...(link && { link }) };
}

function inline(tokens: Token[], bold: boolean, italic: boolean, link?: string): Span[] {
  const spans: Span[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case "strong":
        spans.push(...inline(children(t), true, italic, link));
        break;
      case "em":
        spans.push(...inline(children(t), bold, true, link));
        break;
      case "br":
        spans.push({ text: "\n", font: bodyFont(bold, italic) });
        break;
      case "link": {
        const href = safeHref((t as Tokens.Link).href) ?? undefined;
        spans.push(...inline(children(t), bold, italic, href ?? link));
        break;
      }
      case "image":
        spans.push({ text: (t as Tokens.Image).text, font: bodyFont(bold, italic) });
        break;
      default:
        if (children(t).length > 0) spans.push(...inline(children(t), bold, italic, link));
        else spans.push(plain(t, bold, italic, link));
    }
  }
  return spans;
}

/** Plain text (the album description): paragraphs at blank lines, line breaks kept. */
export function plainParagraphs(text: string, style: TextStyle): Paragraph[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => ({
      spans: [{ text: p, font: "body" as const }],
      size: style.size,
      lineHeight: style.lineHeight,
      color: style.color,
      spaceBefore: i === 0 ? 0 : style.size * 0.8,
    }));
}
