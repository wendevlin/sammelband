<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import Copy from "@lucide/svelte/icons/copy";
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import type { CreatedInvite } from "$lib/types";

/** Shows a freshly created invite link once, with a copy button. */
let {
  open = $bindable(false),
  invite,
  title = "Invite link",
  description,
}: {
  open?: boolean;
  invite: CreatedInvite | null;
  title?: string;
  description?: string;
} = $props();

let copied = $state(false);

async function copy() {
  if (!invite) return;
  await navigator.clipboard.writeText(invite.url);
  copied = true;
  setTimeout(() => (copied = false), 2000);
}
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>
        {description ?? 'Send this link to the person you want to invite.'}
        It works once and expires on
        {invite ? new Date(invite.expiresAt).toLocaleDateString() : ''}. It is shown only now.
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex gap-2">
      <Input
        readonly
        value={invite?.url ?? ''}
        class="font-mono text-xs"
        onfocus={(e) => e.currentTarget.select()}
      />
      <Button variant="outline" size="icon" onclick={copy} aria-label="Copy link">
        {#if copied}
          <Check />
        {:else}
          <Copy />
        {/if}
      </Button>
    </div>
    <Dialog.Footer>
      <Button onclick={() => (open = false)}>Done</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
