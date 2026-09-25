import { invalidate } from '$app/navigation';
import { subscribeAll } from '$lib/ws';

/**
 * Re-run the load functions that `depends(key)` whenever one of the topics
 * fires. Bursts (e.g. a multi-photo upload) are coalesced into one reload.
 * Call during component init.
 */
export function live(topics: () => string[], key: () => string): void {
	$effect(() => {
		const k = key();
		let timer: ReturnType<typeof setTimeout> | null = null;
		const off = subscribeAll(topics(), () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => void invalidate(k), 100);
		});
		return () => {
			if (timer) clearTimeout(timer);
			off();
		};
	});
}
