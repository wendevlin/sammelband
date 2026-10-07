<script lang="ts">
import type { Snippet } from "svelte";
import LanguagePicker from "#lib/components/app/language-picker.svelte";
import Logo from "#lib/components/app/logo.svelte";
import * as Card from "#lib/components/ui/card/index.ts";

let { title, description, children }: { title: string; description?: string; children: Snippet } =
  $props();
</script>

<div class="flex min-h-svh items-center justify-center px-4">
  <div class="w-full max-w-sm">
    <div class="mb-8 flex flex-col items-center gap-3">
      <Logo tile class="size-16 drop-shadow-sm" />
      <p class="font-heading text-3xl text-primary">Sammelband</p>
    </div>
    <Card.Root>
      <Card.Header>
        <Card.Title>{title}</Card.Title>
        {#if description}
          <Card.Description>{description}</Card.Description>
        {/if}
      </Card.Header>
      <Card.Content>{@render children()}</Card.Content>
    </Card.Root>
    <div class="mt-4 flex justify-center"><LanguagePicker /></div>
  </div>
</div>
