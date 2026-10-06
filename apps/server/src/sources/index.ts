import type { SourceId } from "@sammelband/shared";
import { nextcloud } from "./nextcloud";
import type { PhotoSource } from "./types";

/** Every photo source the server knows. A new one (Immich) is one more entry. */
// biome-ignore lint/suspicious/noExplicitAny: each source has its own config and credentials
export const SOURCES: Record<SourceId, PhotoSource<any, any>> = { nextcloud };

export function isSourceId(id: string): id is SourceId {
  return id in SOURCES;
}
