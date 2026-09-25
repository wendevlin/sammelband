<script lang="ts">
import LibraryView from "$lib/components/app/library-view.svelte";
import { live } from "$lib/live.svelte";

let { data } = $props();

live(
  () => ["folder-tree", "album-list"],
  () => "app:library",
);
</script>

<LibraryView
  folder={null}
  folders={data.folders.filter((f) => !f.parent_id)}
  albums={data.albums.filter((a) => !a.folder_id)}
  allFolders={data.folders}
/>
