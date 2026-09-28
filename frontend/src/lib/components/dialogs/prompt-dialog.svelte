<script lang="ts">
import { Button } from "$lib/components/ui/button";
import * as Dialog from "$lib/components/ui/dialog";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";

/** Single-field text dialog (new folder, rename, new album). */
let {
  open = $bindable(false),
  title,
  label,
  value = "",
  submitLabel = "Save",
  onsubmit,
}: {
  open?: boolean;
  title: string;
  label: string;
  value?: string;
  submitLabel?: string;
  onsubmit: (value: string) => Promise<boolean | undefined> | boolean | undefined;
} = $props();

let draft = $state("");
let busy = $state(false);

$effect(() => {
  if (open) draft = value;
});

async function submit(e: SubmitEvent) {
  e.preventDefault();
  const v = draft.trim();
  if (!v) return;
  busy = true;
  const result = await onsubmit(v);
  busy = false;
  if (result !== false) open = false;
}
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <form class="grid gap-6" onsubmit={submit}>
      <Dialog.Header>
        <Dialog.Title>{title}</Dialog.Title>
      </Dialog.Header>
      <div class="grid gap-2">
        <Label for="prompt-field">{label}</Label>
        <Input id="prompt-field" bind:value={draft} required maxlength={200} />
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button type="submit" disabled={busy || !draft.trim()}>{submitLabel}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
