<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import Folder from "@lucide/svelte/icons/folder";
import type { SourceFolder } from "@sammelband/shared";
import { formatDate } from "#lib/i18n.ts";
import { formatBytes } from "#lib/images.ts";
import { m } from "#lib/paraglide/messages.js";

/** The folders inside a source folder, as cards to open, with what's in them. */
let { folders, onopen }: { folders: SourceFolder[]; onopen: (ref: string) => void } = $props();

/** "12 files · 2 folders · 340 MB", or the date when the source tells nothing else. */
function details(f: SourceFolder): string {
  const parts: string[] = [];
  if (f.files !== null && (f.files > 0 || !f.folders))
    parts.push(
      f.files === 1 ? m.picker_folder_files_one() : m.picker_folder_files_other({ count: f.files }),
    );
  if (f.folders)
    parts.push(
      f.folders === 1
        ? m.picker_folder_folders_one()
        : m.picker_folder_folders_other({ count: f.folders }),
    );
  if (f.size) parts.push(formatBytes(f.size));
  if (parts.length === 0 && f.modified !== null) parts.push(formatDate(f.modified));
  return parts.join(" · ");
}
</script>

<ul class="grid grid-cols-1 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
  {#each folders as folder (folder.ref)}
    <li>
      <button
        type="button"
        class="group flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left shadow-xs transition-colors hover:border-foreground/25 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onclick={() => onopen(folder.ref)}
      >
        <Folder class="size-5 shrink-0 fill-primary/15 text-primary" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium">{folder.name}</span>
          {#if details(folder)}
            <span class="block truncate text-xs text-muted-foreground">{details(folder)}</span>
          {/if}
        </span>
        <ChevronRight
          class="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </li>
  {/each}
</ul>
