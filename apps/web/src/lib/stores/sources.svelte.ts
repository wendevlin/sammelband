import type { SourceInfo } from "@sammelband/shared";
import { api } from "#lib/api.ts";

/**
 * The photo sources switched on in the user's Sammelband, with their account.
 * Loaded when first needed (the editor's "Add photos" menu, the profile page)
 * and again after connecting or disconnecting.
 */
class SourcesStore {
  list = $state<SourceInfo[]>([]);
  #loading: Promise<void> | null = null;

  load(force = false): Promise<void> {
    if (force || !this.#loading) {
      this.#loading = api<SourceInfo[]>("/sources")
        .then((list) => {
          this.list = list;
        })
        .catch(() => {
          this.#loading = null;
        });
    }
    return this.#loading;
  }
}

export const sources = new SourcesStore();
