import type { PhotoSwipeOptions } from "photoswipe";
import PhotoSwipeLightbox from "photoswipe/lightbox";
import { m } from "#lib/paraglide/messages.js";

/**
 * PhotoSwipe's options for photos full screen (album page, editor): a solid
 * backdrop, translated buttons, PhotoSwipe itself loaded on first use.
 */
function lightboxOptions(): PhotoSwipeOptions {
  return {
    loop: false,
    // Solid backdrop: the page behind would otherwise show through at 0.8.
    bgOpacity: 1,
    closeTitle: m.lightbox_close(),
    zoomTitle: m.lightbox_zoom(),
    arrowPrevTitle: m.lightbox_previous(),
    arrowNextTitle: m.lightbox_next(),
    // Photos stay clear of the notch, the home indicator and Safari's toolbar.
    paddingFn: safeAreaInsets,
    pswpModule: () => import("photoswipe"),
  };
}

/** The safe area insets in pixels (`env()` only resolves in CSS, so measured). */
function safeAreaInsets(): { top: number; right: number; bottom: number; left: number } {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) " +
    "env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

/** A lightbox for photos full screen (album page, editor). Call `init()` after adding handlers. */
export function createLightbox(): PhotoSwipeLightbox {
  const lightbox = new PhotoSwipeLightbox(lightboxOptions());
  solidRoot(lightbox);
  return lightbox;
}

/**
 * Safari 26 shows the page under its translucent toolbar and tints that area
 * with the background colour of a fixed element at the top edge. PhotoSwipe's
 * root is transparent (the backdrop is a child that fades), so the album showed
 * through above the lightbox. Once it is open, the root gets the backdrop
 * colour itself (`.pswp--solid` in layout.css); while a vertical drag or the
 * closing animation fades the backdrop, it is transparent again.
 */
function solidRoot(lightbox: PhotoSwipeLightbox): void {
  let closing = false;
  const solid = (on: boolean) => lightbox.pswp?.element?.classList.toggle("pswp--solid", on);
  lightbox.on("beforeOpen", () => {
    closing = false;
  });
  lightbox.on("openingAnimationEnd", () => solid(true));
  lightbox.on("verticalDrag", () => solid(false));
  lightbox.on("pointerUp", () => solid(!closing && lightbox.pswp?.opener.isOpen === true));
  lightbox.on("close", () => {
    closing = true;
    solid(false);
  });
}
