<script lang="ts">
import LibraryView from "#lib/components/library/library-view.svelte";
import { live } from "#lib/live.svelte.ts";

let { data } = $props();

live(
  () => ["folder-tree", "album-list"],
  () => "app:library",
);
</script>

<LibraryView
  folder={null}
  folders={data.folders}
  albums={data.albums}
  sort={data.sort}
  allFolders={[]}
/>
