<script lang="ts">
import * as AlertDialog from "$lib/components/ui/alert-dialog";
import { buttonVariants } from "$lib/components/ui/button";

let {
  open = $bindable(false),
  title,
  description,
  confirmLabel = "Delete",
  onconfirm,
}: {
  open?: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  onconfirm: () => Promise<unknown> | unknown;
} = $props();

let busy = $state(false);

async function confirm() {
  busy = true;
  await onconfirm();
  busy = false;
  open = false;
}
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      {#if description}
        <AlertDialog.Description>{description}</AlertDialog.Description>
      {/if}
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        class={buttonVariants({ variant: 'destructive' })}
        disabled={busy}
        onclick={confirm}
      >
        {confirmLabel}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
