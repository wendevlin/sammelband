<script lang="ts">
import { cn } from "#lib/utils.ts";

/** A user's avatar, or their initials on a colored circle. */
let {
  name,
  image,
  class: className = "size-8 text-xs",
}: { name: string; image: string | null | undefined; class?: string } = $props();

const initials = $derived(
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?",
);
</script>

{#if image}
  <img src={image} alt="" class={cn("shrink-0 rounded-full object-cover", className)}>
{:else}
  <span
    class={cn(
      "inline-flex shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary",
      className,
    )}
    aria-hidden="true"
  >
    {initials}
  </span>
{/if}
