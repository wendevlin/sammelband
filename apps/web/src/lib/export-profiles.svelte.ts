import type { ExportProfile } from "@sammelband/shared";
import { api } from "#lib/api.ts";
import { onReconnect, subscribeAll } from "#lib/ws.ts";

/**
 * The print profiles exports can be made with in this Sammelband, kept
 * current: admins switching profiles on or off reloads them.
 * Create during component init.
 */
export class ExportProfiles {
  list = $state<ExportProfile[]>([]);
  loaded = $state(false);

  constructor(active: () => boolean = () => true) {
    $effect(() => {
      if (!active()) return;
      const reload = () => {
        api<ExportProfile[]>("/export-profiles")
          .then((rows) => {
            this.list = rows;
            this.loaded = true;
          })
          .catch(() => {});
      };
      reload();
      const off = subscribeAll(["export-profiles"], reload);
      const offReconnect = onReconnect(reload);
      return () => {
        off();
        offReconnect();
      };
    });
  }
}
