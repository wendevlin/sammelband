<script lang="ts">
import type { Section } from "@sammelband/shared";
import { cn } from "#lib/utils.ts";
import MarkdownText from "./markdown-text.svelte";

/**
 * A section's title and text as a slide of the album lightbox, shown before
 * its photos, so the viewer sees where a new section begins. Mounted by
 * album-content.svelte into PhotoSwipe's slide. Long text scrolls in its box.
 */
let { section }: { section: Section } = $props();
</script>

<div class="sb-section-slide">
  <div class="sb-section-slide__box">
    {#if section.title.trim()}
      <h2 class="font-heading text-3xl leading-tight sm:text-4xl">{section.title}</h2>
    {/if}
    {#if section.text.trim()}
      <MarkdownText
        text={section.text}
        class={cn("prose prose-lg max-w-none prose-invert", section.title.trim() && "mt-6")}
      />
    {/if}
  </div>
</div>
