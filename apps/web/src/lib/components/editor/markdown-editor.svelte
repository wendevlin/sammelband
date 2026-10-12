<script lang="ts">
import Bold from "@lucide/svelte/icons/bold";
import Italic from "@lucide/svelte/icons/italic";
import List from "@lucide/svelte/icons/list";
import ListOrdered from "@lucide/svelte/icons/list-ordered";
import { Editor } from "@tiptap/core";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { onDestroy, onMount } from "svelte";
import { MARKED_OPTIONS } from "#lib/markdown.ts";
import { m } from "#lib/paraglide/messages.js";
import { cn } from "#lib/utils.ts";

/**
 * Rich text that's stored as Markdown: no syntax on screen. Typing `**bold**`,
 * `- ` or `1. ` formats as you go, Ctrl+B / Ctrl+I work, and a pasted URL
 * becomes a link (on selected text, it links that text).
 */
let {
  value,
  placeholder,
  onchange,
  onblur,
}: {
  value: string;
  placeholder: string;
  onchange: (markdown: string) => void;
  onblur?: () => void;
} = $props();

/** Classes of the editable text, shared with the placeholder's stand-in below. */
const CONTENT = "prose prose-stone dark:prose-invert max-w-none min-h-16 px-3 py-2";

let element = $state<HTMLDivElement | null>(null);
let editor = $state.raw<Editor | null>(null);
/** Bumped on every transaction, so the toolbar's active states recompute. */
let tick = $state(0);
/** The Markdown this editor last produced or loaded, to tell our own changes from others'. */
let current = "";

onMount(() => {
  current = value;
  editor = new Editor({
    element: element ?? undefined,
    extensions: [
      StarterKit.configure({
        // A section has its own title; no headings, code blocks or rules in the text.
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        underline: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder: () => placeholder }),
      Markdown.configure({ markedOptions: MARKED_OPTIONS }),
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: `${CONTENT} outline-none`,
        "aria-label": placeholder,
      },
    },
    onTransaction: () => tick++,
    onUpdate: ({ editor: e }) => {
      // Empty paragraphs at the end would be stored as trailing blank lines.
      current = e.getMarkdown().trimEnd();
      onchange(current);
    },
    onBlur: () => onblur?.(),
  });
});

onDestroy(() => editor?.destroy());

// Someone else changed the text (live update): show it, unless it's being edited here.
$effect(() => {
  if (!editor || value === current || editor.isFocused) return;
  current = value;
  editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
});

type Tool = { label: string; icon: typeof Bold; name: string; run: (e: Editor) => boolean };
const tools: Tool[] = [
  {
    label: m.format_bold(),
    icon: Bold,
    name: "bold",
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    label: m.format_italic(),
    icon: Italic,
    name: "italic",
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    label: m.format_bullet_list(),
    icon: List,
    name: "bulletList",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: m.format_ordered_list(),
    icon: ListOrdered,
    name: "orderedList",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
];
// Tiptap's placeholder floats with no height, so a long one (narrow phones,
// German) spilled out of the box. While the text is empty, an invisible copy in
// the same grid cell gives the box the placeholder's height.
const empty = $derived.by(() => {
  void tick;
  return editor ? editor.isEmpty : value.trim() === "";
});
const active = (name: string) => {
  void tick;
  return editor?.isActive(name) ?? false;
};
</script>

<div
  class="rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
>
  <div class="flex gap-0.5 border-b border-input/60 px-1 py-1" role="toolbar">
    {#each tools as tool (tool.name)}
      <button
        type="button"
        class={cn(
          "flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground",
          active(tool.name) && "bg-muted text-foreground",
        )}
        aria-label={tool.label}
        aria-pressed={active(tool.name)}
        title={tool.label}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => editor && tool.run(editor)}
      >
        <tool.icon class="size-4" />
      </button>
    {/each}
  </div>
  <div class="grid">
    {#if empty}
      <div class={cn(CONTENT, "invisible [grid-area:1/1]")} aria-hidden="true">
        <p>{placeholder}</p>
      </div>
    {/if}
    <div bind:this={element} class="grid [grid-area:1/1]"></div>
  </div>
</div>
