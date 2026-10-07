import { onReconnect, subscribeAll } from "#lib/ws.ts";
import { invalidate } from "$app/navigation";
import { navigating } from "$app/state";

/**
 * Re-run the load functions that `depends(key)` whenever one of the topics
 * fires. Bursts (e.g. a multi-photo upload) are coalesced into one reload.
 * Also reloads after a dropped connection, since events may have been missed.
 * Call during component init.
 */
export function live(topics: () => string[], key: () => string): void {
  $effect(() => {
    const k = key();
    let timer: ReturnType<typeof setTimeout> | null = null;
    // An invalidate() during a navigation supersedes it: SvelteKit drops the
    // navigation and the progress bar keeps running (creating an album emits
    // album-list events while goto() loads the editor). So wait until the
    // navigation is done; if it leaves this page, the cleanup drops the reload.
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (navigating.to) schedule();
        else void invalidate(k);
      }, 100);
    };
    const off = subscribeAll(topics(), schedule);
    const offReconnect = onReconnect(schedule);
    return () => {
      if (timer) clearTimeout(timer);
      off();
      offReconnect();
    };
  });
}
