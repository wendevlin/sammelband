<script lang="ts">
import { cn } from "#lib/utils.ts";

// The Sammelband mark: an album with a page of photos. The album takes the
// current text color, the cut-outs take the page background, so it works in
// both themes. `tile` is the app-icon version used for the favicon.
let { tile = false, class: className }: { tile?: boolean; class?: string } = $props();
</script>

{#if tile}
  <svg viewBox="0 0 32 32" class={cn("size-8", className)} aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="#7B1E2E" />
    <rect x="8.5" y="6.5" width="16" height="19.5" rx="1.6" fill="#D9C3B9" />
    <rect x="7.5" y="5.5" width="16" height="19.5" rx="1.4" fill="#FAF6F1" />
    <path d="M8.9 5.5H10V25H8.9a1.4 1.4 0 0 1-1.4-1.4V6.9a1.4 1.4 0 0 1 1.4-1.4Z" fill="#EADAD2" />
    <g fill="#7B1E2E">
      <rect x="11.4" y="7.8" width="10" height="6" rx=".6" />
      <rect x="11.4" y="14.8" width="6" height="1.2" rx=".6" />
      <rect x="11.4" y="16.6" width="10" height=".7" rx=".35" />
      <rect x="11.4" y="17.9" width="7" height=".7" rx=".35" />
      <rect x="11.4" y="19.2" width="4.5" height="4" rx=".5" />
      <rect x="16.9" y="19.2" width="4.5" height="4" rx=".5" />
    </g>
    <path
      d="M13.65 22.2c-.55-.6-.7-.95-.7-1.3a.7.7 0 0 1 1.4 0c0 .35-.15.7-.7 1.3Z"
      fill="#FAF6F1"
    />
    <circle cx="13.65" cy="20.9" r=".26" fill="#7B1E2E" />
  </svg>
{:else}
  <svg viewBox="4 4 24 24" class={cn("size-8 text-primary", className)} aria-hidden="true">
    <rect
      x="8.5"
      y="6.5"
      width="16"
      height="19.5"
      rx="1.6"
      fill="currentColor"
      fill-opacity=".55"
    />
    <rect x="7.5" y="5.5" width="16" height="19.5" rx="1.4" fill="currentColor" />
    <g class="fill-background">
      <rect x="9.7" y="5.5" width=".5" height="19.5" />
      <rect x="11.4" y="7.8" width="10" height="6" rx=".6" />
      <rect x="11.4" y="14.8" width="6" height="1.2" rx=".6" />
      <rect x="11.4" y="16.6" width="10" height=".7" rx=".35" />
      <rect x="11.4" y="17.9" width="7" height=".7" rx=".35" />
      <rect x="11.4" y="19.2" width="4.5" height="4" rx=".5" />
      <rect x="16.9" y="19.2" width="4.5" height="4" rx=".5" />
    </g>
    <path
      d="M13.65 22.2c-.55-.6-.7-.95-.7-1.3a.7.7 0 0 1 1.4 0c0 .35-.15.7-.7 1.3Z"
      fill="currentColor"
    />
    <circle cx="13.65" cy="20.9" r=".26" class="fill-background" />
  </svg>
{/if}
