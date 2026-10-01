import type { Album, AlbumDetail, AlbumPatch, Photo, Section } from "@sammelband/shared";
import { createContext } from "svelte";

/**
 * The open album, kept current by patches from /ws instead of refetching.
 * The album layout owns it: `reset` on every load, `apply` on every event.
 * Arrays are replaced (not mutated) so `$derived`s downstream recompute.
 */
export class AlbumState {
  album = $state.raw<Album>() as Album;
  sections = $state.raw<Section[]>([]);
  photos = $state.raw<Photo[]>([]);

  constructor(detail: AlbumDetail) {
    this.reset(detail);
  }

  reset(detail: AlbumDetail): void {
    this.album = detail.album;
    this.sections = detail.sections;
    this.photos = detail.photos;
  }

  apply(patch: AlbumPatch): void {
    if (patch.album) this.album = patch.album;
    if (patch.sections?.length || patch.removedSections?.length) {
      this.sections = merge(this.sections, patch.sections, patch.removedSections);
    }
    const goneSections = new Set(patch.removedSections);
    if (patch.photos?.length || patch.removedPhotos?.length || goneSections.size) {
      this.photos = merge(this.photos, patch.photos, patch.removedPhotos).filter(
        (p) => !goneSections.has(p.section_id),
      );
    }
  }
}

function merge<T extends { id: string }>(
  rows: T[],
  upserts: T[] = [],
  removed: string[] = [],
): T[] {
  const byId = new Map(upserts.map((r) => [r.id, r]));
  const gone = new Set(removed);
  const next = rows.filter((r) => !gone.has(r.id)).map((r) => byId.get(r.id) ?? r);
  const known = new Set(rows.map((r) => r.id));
  for (const r of upserts) if (!known.has(r.id) && !gone.has(r.id)) next.push(r);
  return next;
}

export const [getAlbumState, setAlbumState] = createContext<AlbumState>();
