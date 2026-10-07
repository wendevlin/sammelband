<script lang="ts">
import type { SourceId } from "@sammelband/shared";
import { SOURCE_ICONS } from "#lib/sources.ts";

let { id, class: className }: { id: SourceId; class?: string } = $props();
const Icon = $derived(SOURCE_ICONS[id]);
</script>

<Icon class={className} />
