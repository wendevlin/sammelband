<script lang="ts">
import SharedPage from "#lib/components/share/shared-page.svelte";

let { data } = $props();
</script>

<SharedPage token={data.token} view={data.view} />
