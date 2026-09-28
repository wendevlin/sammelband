<script lang="ts">
import * as AlertDialog from "$lib/components/ui/alert-dialog";

/** A message that stays until acknowledged (unlike a toast). */
let {
  open = $bindable(false),
  title,
  description,
}: { open?: boolean; title: string; description?: string } = $props();
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
      <AlertDialog.Action>OK</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
