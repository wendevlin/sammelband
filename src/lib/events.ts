/**
 * In-process pub/sub for resource change notifications.
 *
 * Topics are strings: either keyless ("folder-tree", "album-list", "storage-stats")
 * or `<kind>:<id>` ("album:abc", "folder:xyz", "photo-pool:abc"). Every topic
 * exists once per tenant: emit() publishes to the tenant in context, and
 * subscribers name the tenant they belong to, so events never cross tenants.
 *
 * Single-process by design — this app is one Bun process. If we ever scale to
 * multiple replicas, swap the listener map for Redis pub/sub or Postgres
 * LISTEN/NOTIFY. The public API (`emit`, `subscribe`) stays the same.
 */

import type { Album, AlbumBlock, Photo } from "../db/schema";
import { currentTenantId } from "./tenant-context";

export type EventKind = "created" | "updated" | "deleted";

export type ChangeEvent = {
  topic: string;
  kind: EventKind;
  id?: string;
  data?: unknown;
};

type Listener = (e: ChangeEvent) => void;

const listeners = new Map<string, Set<Listener>>();

const key = (tenantId: string, topic: string) => `${tenantId}/${topic}`;

export function subscribe(tenantId: string, topic: string, listener: Listener): () => void {
  const k = key(tenantId, topic);
  let set = listeners.get(k);
  if (!set) {
    set = new Set();
    listeners.set(k, set);
  }
  set.add(listener);
  return () => {
    const s = listeners.get(k);
    s?.delete(listener);
    if (s && s.size === 0) listeners.delete(k);
  };
}

/** Publish to the subscribers of the current tenant. */
export function emit(event: ChangeEvent): void {
  const subs = listeners.get(key(currentTenantId(), event.topic));
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn(event);
    } catch (err) {
      console.error("[events] listener threw", { topic: event.topic, err });
    }
  }
}

/** A photo as the album page sees it: the row plus its image metadata. */
export type PhotoWithImage = Photo & {
  filename: string;
  width: number;
  height: number;
  placeholder: string;
};

/**
 * What changed in an album, as full rows. Clients replace rows by id and drop
 * removed ids, so applying a patch twice or out of order is harmless. Rows are
 * small (a photo is ~2 KB, mostly its blur placeholder); images never go here.
 */
export type AlbumPatch = {
  album?: Album;
  blocks?: AlbumBlock[];
  photos?: PhotoWithImage[];
  removedBlocks?: string[];
  removedPhotos?: string[];
};

export function emitAlbumPatch(albumId: string, patch: AlbumPatch): void {
  emit({ topic: topics.album(albumId), kind: "updated", id: albumId, data: patch });
}

// Convenience emitters used by services so the topic strings live in one place.

export const topics = {
  folderTree: () => "folder-tree",
  folder: (id: string) => `folder:${id}`,
  albumList: () => "album-list",
  album: (id: string) => `album:${id}`,
  photoPool: (albumId: string) => `photo-pool:${albumId}`,
  storageStats: () => "storage-stats",
} as const;
