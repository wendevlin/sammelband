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

type Insets = { top: number; right: number; bottom: number; left: number };

let measured: { key: string; insets: Insets } | null = null;

/**
 * The safe area insets in pixels (`env()` only resolves in CSS, so measured).
 * PhotoSwipe asks once per side and per pan bounds update; the insets only
 * change with the viewport (rotation), so one measurement per size is enough.
 */
function safeAreaInsets(viewportSize: { x: number; y: number }): Insets {
  const key = `${viewportSize.x}x${viewportSize.y}`;
  if (measured?.key !== key) measured = { key, insets: measureInsets() };
  return measured.insets;
}

function measureInsets(): Insets {
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
 * Safari 26 shows the page under its translucent toolbar: a fixed element,
 * even one at the top edge, starts below it. So once the lightbox is open,
 * the page itself goes dark: the app is hidden (keeping its scroll position)
 * and the document background is the backdrop colour (`.lightbox-covers` in
 * layout.css), so only black is left under the toolbar. PhotoSwipe's root
 * gets the backdrop colour too (`.pswp--solid`), for browsers that tint the
 * toolbar from it. While a vertical drag, a pinch to close or the closing
 * animation fades the backdrop, the page is back, so the fades still work.
 */
function solidRoot(lightbox: PhotoSwipeLightbox): void {
  let closing = false;
  const solid = (on: boolean) => {
    lightbox.pswp?.element?.classList.toggle("pswp--solid", on);
    document.documentElement.classList.toggle("lightbox-covers", on);
  };
  lightbox.on("beforeOpen", () => {
    closing = false;
  });
  lightbox.on("openingAnimationEnd", () => solid(true));
  lightbox.on("verticalDrag", () => solid(false));
  lightbox.on("pinchClose", () => solid(false));
  lightbox.on("pointerUp", () => solid(!closing && lightbox.pswp?.opener.isOpen === true));
  lightbox.on("close", () => {
    closing = true;
    solid(false);
  });
  lightbox.on("destroy", () => solid(false));
}
