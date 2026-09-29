<script lang="ts">
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { m } from "$lib/paraglide/messages.js";

/** Confirm a sensitive action with the current password. */
let {
  open = $bindable(false),
  title,
  description,
  submitLabel,
  destructive = false,
  onsubmit,
}: {
  open?: boolean;
  title: string;
  description?: string;
  submitLabel: string;
  destructive?: boolean;
  onsubmit: (password: string) => Promise<boolean>;
} = $props();

let password = $state("");
let busy = $state(false);

$effect(() => {
  if (open) password = "";
});

async function submit(e: SubmitEvent) {
  e.preventDefault();
  busy = true;
  const ok = await onsubmit(password);
  busy = false;
  if (ok) open = false;
}
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-6" onsubmit={submit}>
      <Dialog.Header>
        <Dialog.Title>{title}</Dialog.Title>
        {#if description}
          <Dialog.Description>{description}</Dialog.Description>
        {/if}
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="confirm-password">{m.two_factor_password_label()}</Label>
        <Input
          id="confirm-password"
          type="password"
          bind:value={password}
          required
          autocomplete="current-password"
        />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (open = false)}>{m.common_cancel()}</Button>
        <Button
          type="submit"
          variant={destructive ? 'destructive' : 'default'}
          disabled={busy || !password}
        >
          {submitLabel}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
