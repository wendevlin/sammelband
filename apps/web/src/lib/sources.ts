import Cloud from "@lucide/svelte/icons/cloud";
import type { SourceId } from "@sammelband/shared";

// What the web app knows about each photo source besides the API: its icon.
// Browsing and importing work the same for every source (source-picker.svelte);
// connecting an account is per source (profile page). Immich: one more entry.

export const SOURCE_ICONS: Record<SourceId, typeof Cloud> = { nextcloud: Cloud };

export const thumbnailUrl = (source: SourceId, thumb: string, size: 128 | 256 | 512 = 256) =>
  `/api/sources/${source}/thumbnail?${new URLSearchParams({ id: thumb, size: String(size) })}`;
