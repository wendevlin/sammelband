import type { Album, AlbumBlock, AlbumDetail, AlbumPatch, Photo } from "@sammelband/shared";
import { createContext } from "svelte";

/**
 * The open album, kept current by patches from /ws instead of refetching.
 * The album layout owns it: `reset` on every load, `apply` on every event.
 * Arrays are replaced (not mutated) so `$derived`s downstream recompute.
 */
export class AlbumState {
  album = $state.raw<Album>() as Album;
  blocks = $state.raw<AlbumBlock[]>([]);
  photos = $state.raw<Photo[]>([]);

  constructor(detail: AlbumDetail) {
    this.reset(detail);
  }

  reset(detail: AlbumDetail): void {
    this.album = detail.album;
    this.blocks = detail.blocks;
    this.photos = detail.photos;
  }

  apply(patch: AlbumPatch): void {
    if (patch.album) this.album = patch.album;
    if (patch.blocks?.length || patch.removedBlocks?.length) {
      this.blocks = merge(this.blocks, patch.blocks, patch.removedBlocks);
    }
    const goneBlocks = new Set(patch.removedBlocks);
    if (patch.photos?.length || patch.removedPhotos?.length || goneBlocks.size) {
      this.photos = merge(this.photos, patch.photos, patch.removedPhotos).filter(
        (p) => !goneBlocks.has(p.block_id),
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
