import type { AlbumExport } from "@sammelband/shared";
import { api } from "#lib/api.ts";
import { onReconnect, subscribeAll } from "#lib/ws.ts";

/**
 * An album's PDF exports, kept current: the server sends every change
 * (progress included) as an event with the full row, so this applies them
 * without refetching, and reloads after a dropped connection.
 * Create during component init.
 */
export class AlbumExports {
  list = $state<AlbumExport[]>([]);

  constructor(albumId: () => string) {
    $effect(() => {
      const id = albumId();
      const reload = () => {
        api<AlbumExport[]>(`/albums/${id}/exports`)
          .then((rows) => {
            this.list = rows;
          })
          .catch(() => {});
      };
      reload();
      const off = subscribeAll([`album-exports:${id}`], (event) => {
        if (event.kind === "deleted") this.list = this.list.filter((x) => x.id !== event.id);
        else if (event.data) this.upsert(event.data as AlbumExport);
      });
      const offReconnect = onReconnect(reload);
      return () => {
        off();
        offReconnect();
      };
    });
  }

  upsert(row: AlbumExport): void {
    const i = this.list.findIndex((x) => x.id === row.id);
    if (i === -1) this.list = [row, ...this.list];
    else this.list[i] = row;
  }

  get(id: string | null): AlbumExport | undefined {
    return id ? this.list.find((x) => x.id === id) : undefined;
  }
}

/** Where a finished export downloads from. */
export function exportUrl(id: string): string {
  return `/api/exports/${id}/file`;
}
