<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import Download from "@lucide/svelte/icons/download";
import { toast } from "svelte-sonner";
import { Button } from "$lib/components/ui/button";
import { m } from "$lib/paraglide/messages.js";

/** Freshly generated backup codes: shown once, to copy or download. */
let { codes }: { codes: string[] } = $props();

const text = $derived(`Sammelband backup codes\n\n${codes.join("\n")}\n`);

async function copy() {
  await navigator.clipboard.writeText(codes.join("\n"));
  toast.success(m.two_factor_backup_copied());
}

function download() {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "sammelband-backup-codes.txt";
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<div class="grid gap-3">
  <div>
    <p class="font-medium">{m.two_factor_backup_title()}</p>
    <p class="text-sm text-muted-foreground">{m.two_factor_backup_description()}</p>
  </div>
  <ul class="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-muted/40 p-4 font-mono text-sm">
    {#each codes as code (code)}
      <li>{code}</li>
    {/each}
  </ul>
  <div class="flex flex-wrap gap-2">
    <Button variant="outline" size="sm" onclick={copy}
      ><Copy /> {m.two_factor_backup_copy()}</Button
    >
    <Button variant="outline" size="sm" onclick={download}
      ><Download />
      {m.two_factor_backup_download()}</Button
    >
  </div>
</div>
