/**
 * In-process pub/sub for resource change notifications.
 *
 * Topics are strings: either keyless ("folder-tree", "album-list", "storage-stats")
 * or `<kind>:<id>` ("album:abc", "folder:xyz", "photo-pool:abc").
 *
 * Single-process by design — this app is one Bun + one SQLite DB. If we ever
 * scale to multiple replicas, swap the listener map for Redis pub/sub or
 * SQLite triggers + LISTEN/NOTIFY equivalent. The public API (`emit`, `subscribe`)
 * stays the same.
 */

export type EventKind = "created" | "updated" | "deleted";

export type ChangeEvent = {
  topic: string;
  kind: EventKind;
  id?: string;
  data?: unknown;
};

type Listener = (e: ChangeEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(topic: string, listener: Listener): () => void {
  let set = listeners.get(topic);
  if (!set) {
    set = new Set();
    listeners.set(topic, set);
  }
  set.add(listener);
  return () => {
    const s = listeners.get(topic);
    s?.delete(listener);
    if (s && s.size === 0) listeners.delete(topic);
  };
}

export function emit(event: ChangeEvent): void {
  const subs = listeners.get(event.topic);
  if (!subs) return;
  for (const fn of subs) {
    try {
      fn(event);
    } catch (err) {
      console.error("[events] listener threw", { topic: event.topic, err });
    }
  }
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
