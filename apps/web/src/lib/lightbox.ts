import type { PhotoSwipeOptions } from "photoswipe";
import { m } from "#lib/paraglide/messages.js";

/**
 * PhotoSwipe's options for photos full screen (album page, editor): a solid
 * backdrop, translated buttons, PhotoSwipe itself loaded on first use.
 */
export function lightboxOptions(): PhotoSwipeOptions {
  return {
    loop: false,
    // Solid backdrop: the page behind would otherwise show through at 0.8.
    bgOpacity: 1,
    closeTitle: m.lightbox_close(),
    zoomTitle: m.lightbox_zoom(),
    arrowPrevTitle: m.lightbox_previous(),
    arrowNextTitle: m.lightbox_next(),
    pswpModule: () => import("photoswipe"),
  };
}
