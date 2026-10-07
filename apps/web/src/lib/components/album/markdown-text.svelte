<script lang="ts">
import type { Token, Tokens } from "marked";
import { lex, safeHref } from "#lib/markdown.ts";

/**
 * Markdown as Svelte elements: paragraphs, emphasis, links, lists, quotes,
 * code. Raw HTML in the text shows as text; nothing goes through {@html}.
 */
let { text, class: className }: { text: string; class?: string } = $props();

const tokens = $derived(lex(text));
const children = (t: Token): Token[] => ("tokens" in t && t.tokens) || [];
const raw = (t: Token): string => ("text" in t && typeof t.text === "string" ? t.text : t.raw);
const href = (t: Token) => safeHref((t as Tokens.Link).href);
</script>

{#snippet inline(
  list: Token[],
)}
  {#each list as t, i (i)}
    {#if t.type === "strong"}
      <strong>{@render inline(children(t))}</strong>
    {:else if t.type === "em"}
      <em>{@render inline(children(t))}</em>
    {:else if t.type === "del"}
      <del>{@render inline(children(t))}</del>
    {:else if t.type === "codespan"}
      <code>{(t as Tokens.Codespan).text}</code>
    {:else if t.type === "br"}
      <br>
    {:else if t.type === "link" && href(t)}
      <a href={href(t)} target="_blank" rel="noopener noreferrer nofollow"
        >{@render inline(children(t))}</a
      >
    {:else if t.type === "image"}
      {(t as Tokens.Image).text}
    {:else if children(t).length > 0}
      {@render inline(children(t))}
    {:else}
      {raw(t)}
    {/if}
  {/each}
{/snippet}

{#snippet list(
  l: Tokens.List,
)}
  {#if l.ordered}
    <ol start={typeof l.start === "number" ? l.start : undefined}>
      {#each l.items as item, j (j)}
        <li>{@render blocks(item.tokens)}</li>
      {/each}
    </ol>
  {:else}
    <ul>
      {#each l.items as item, j (j)}
        <li>{@render blocks(item.tokens)}</li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#snippet blocks(
  tokens: Token[],
)}
  {#each tokens as t, i (i)}
    {#if t.type === "paragraph"}
      <p>{@render inline(children(t))}</p>
    {:else if t.type === "heading"}
      <h3>{@render inline(children(t))}</h3>
    {:else if t.type === "list"}
      {@render list(t as Tokens.List)}
    {:else if t.type === "blockquote"}
      <blockquote>{@render blocks(children(t))}</blockquote>
    {:else if t.type === "code"}
      <pre><code>{(t as Tokens.Code).text}</code></pre>
    {:else if t.type === "hr"}
      <hr>
    {:else if t.type === "text"}
      <!-- Text directly in a tight list item. -->
      {@render inline(children(t).length > 0 ? children(t) : [t])}
    {:else if t.type !== "space"}
      <p>{t.raw}</p>
    {/if}
  {/each}
{/snippet}

<div class={className}>{@render blocks(tokens)}</div>
