<script lang="ts">
import { page } from "$app/state";
import LibraryView from "$lib/components/app/library-view.svelte";
import { live } from "$lib/live.svelte";

let { data } = $props();

live(
  () => [`folder:${page.params.id}`, "folder-tree", "album-list"],
  () => `app:folder:${page.params.id}`,
);
</script>

<LibraryView
  folder={data.folder}
  folders={data.folders}
  albums={data.albums}
  sort={data.sort}
  allFolders={data.allFolders}
/>
