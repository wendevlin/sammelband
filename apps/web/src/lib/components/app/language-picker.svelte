<script lang="ts">
import Languages from "@lucide/svelte/icons/languages";
import { Button } from "#lib/components/ui/button/index.ts";
import * as DropdownMenu from "#lib/components/ui/dropdown-menu/index.ts";
import { getLocale, LOCALE_NAMES, type Locale, locales, m, switchLocale } from "#lib/i18n.ts";

/**
 * Language menu for pages without an account context (sign-in, setup,
 * invites). Signed-in users pick theirs in the profile, saved with the account.
 */
let { onchange }: { onchange?: (locale: Locale) => void } = $props();
const current = getLocale();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    {#snippet child({
      props,
    })}
      <Button {...props} variant="ghost" size="sm" aria-label={m.language()}>
        <Languages />
        {LOCALE_NAMES[current]}
      </Button>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="center" class="min-w-40">
    <DropdownMenu.RadioGroup
      value={current}
      onValueChange={(v) => {
        onchange?.(v as Locale);
        switchLocale(v as Locale);
      }}
    >
      {#each locales as locale (locale)}
        <DropdownMenu.RadioItem value={locale} class="normal-case tracking-normal">
          {LOCALE_NAMES[locale]}
        </DropdownMenu.RadioItem>
      {/each}
    </DropdownMenu.RadioGroup>
  </DropdownMenu.Content>
</DropdownMenu.Root>
