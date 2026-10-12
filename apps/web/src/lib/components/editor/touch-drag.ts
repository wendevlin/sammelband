import type { Attachment } from "svelte/attachments";
import { edgeAutoscroll } from "#lib/drag-autoscroll.ts";
import { LONG_PRESS_MS, TOUCH_SLOP } from "./drag-select";

/**
 * Drag an element with a finger or pen, where HTML5 drag and drop doesn't
 * work (mobile browsers). Press and hold it (`LONG_PRESS_MS`) to pick it up,
 * with a short vibration. A finger that moves more than `TOUCH_SLOP` before
 * is scrolling, and the page scrolls as usual.
 *
 * While dragging, a copy of the element follows the finger, the page doesn't
 * scroll under the finger but does near the top and bottom edges, and no
 * click follows. Buttons and fields inside the element work as before and
 * don't start a drag. Mouse presses are left to HTML5 drag and drop: the
 * element is only `draggable` for them.
 *
 * What is under the finger and what a drop does is up to the callbacks.
 */
export type TouchDragOptions = {
  /** The element was picked up. */
  onstart: () => void;
  /** The finger is at (x, y) in the viewport: it moved, or the page scrolled under it. */
  onmove: (x: number, y: number) => void;
  /** Let go (`dropped`), or cancelled by the browser. Only after `onstart`. */
  onend: (dropped: boolean) => void;
  /**
   * What follows the finger, made at pick-up: e.g. a small card for a handle
   * that stands for something bigger. Without it, a smaller copy of the element.
   */
  preview?: () => HTMLElement;
};

const CONTROLS = "a, button, input, select, textarea, [contenteditable]";
/** The copy under the finger is smaller, so the drop target around it stays visible. */
const GHOST_SCALE = 0.6;

type Drag = {
  pointer: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
  /** Picked up (the long press is over). */
  ghost: HTMLElement | null;
  /** Where the finger holds the element, from its top left corner. */
  offsetX: number;
  offsetY: number;
};

/** One drag at a time, also across elements (a second finger). */
let busy = false;

export function touchDrag(options: TouchDragOptions): Attachment<HTMLElement> {
  return (el) => {
    const draggable = el.draggable;
    let drag: Drag | null = null;
    let mouse = true;
    const scroller = edgeAutoscroll();
    // A long press neither selects text nor opens the iOS image callout.
    el.style.userSelect = "none";
    el.style.setProperty("-webkit-user-select", "none");
    el.style.setProperty("-webkit-touch-callout", "none");

    function down(e: PointerEvent) {
      mouse = e.pointerType === "mouse";
      el.draggable = draggable && mouse;
      if (mouse || busy || !e.isPrimary || e.button !== 0) return;
      const control = (e.target as Element).closest(CONTROLS);
      if (control && control !== el && el.contains(control)) return;
      busy = true;
      drag = {
        pointer: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(pickUp, LONG_PRESS_MS),
        ghost: null,
        offsetX: 0,
        offsetY: 0,
      };
    }

    function pickUp() {
      if (!drag) return;
      navigator.vibrate?.(10);
      const rect = el.getBoundingClientRect();
      drag.offsetX = drag.x - rect.left;
      drag.offsetY = drag.y - rect.top;
      drag.ghost = options.preview ? float(options.preview(), drag) : ghostOf(el, rect, drag);
      window.addEventListener("scroll", follow, { passive: true });
      options.onstart();
      follow();
    }

    function move(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.pointer) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!drag.ghost) {
        // Moved before the long press: the user is scrolling.
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > TOUCH_SLOP) end(e, false);
        return;
      }
      scroller.move(drag.y);
      follow();
    }

    function follow() {
      if (!drag?.ghost) return;
      drag.ghost.style.translate = `${drag.x - drag.offsetX}px ${drag.y - drag.offsetY}px`;
      options.onmove(drag.x, drag.y);
    }

    function end(e: PointerEvent | null, dropped: boolean) {
      if (!drag || (e && e.pointerId !== drag.pointer)) return;
      const { ghost, timer } = drag;
      clearTimeout(timer);
      drag = null;
      busy = false;
      if (!ghost) return;
      ghost.remove();
      scroller.stop();
      window.removeEventListener("scroll", follow);
      swallowNextClick();
      options.onend(dropped);
    }

    const up = (e: PointerEvent) => end(e, true);
    const cancel = (e: PointerEvent) => end(e, false);
    // Once picked up, the finger drags instead of scrolling.
    function touchMove(e: TouchEvent) {
      if (drag?.ghost && e.cancelable) e.preventDefault();
    }
    // No long-press menu (save image, …), no native drag from a touch.
    function preventForTouch(e: Event) {
      if (!mouse) e.preventDefault();
    }

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("touchmove", touchMove, { passive: false });
    el.addEventListener("contextmenu", preventForTouch);
    el.addEventListener("dragstart", preventForTouch);
    return () => {
      end(null, false);
      el.draggable = draggable;
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("touchmove", touchMove);
      el.removeEventListener("contextmenu", preventForTouch);
      el.removeEventListener("dragstart", preventForTouch);
    };
  };
}

/** `preview`, floating where the finger holds the element. */
function float(preview: HTMLElement, drag: Drag): HTMLElement {
  preview.setAttribute("aria-hidden", "true");
  Object.assign(preview.style, {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "100",
    margin: "0",
    pointerEvents: "none",
    opacity: "0.95",
    translate: `${drag.x - drag.offsetX}px ${drag.y - drag.offsetY}px`,
  });
  document.body.append(preview);
  return preview;
}

/** A copy of `el` without its controls, floating where the finger holds it. */
function ghostOf(el: HTMLElement, rect: DOMRect, drag: Drag): HTMLElement {
  const ghost = el.cloneNode(true) as HTMLElement;
  for (const control of ghost.querySelectorAll(CONTROLS)) control.remove();
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "100",
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    pointerEvents: "none",
    opacity: "0.9",
    boxShadow: "0 10px 30px rgb(0 0 0 / 0.35)",
    translate: `${rect.left}px ${rect.top}px`,
    scale: "1",
    transformOrigin: `${drag.offsetX}px ${drag.offsetY}px`,
    transition: "scale 150ms ease-out",
  });
  document.body.append(ghost);
  // Shrinks towards the finger once it's there.
  requestAnimationFrame(() => {
    ghost.style.scale = String(GHOST_SCALE);
  });
  return ghost;
}

/** The click that may follow a drag is swallowed: a drag is no tap. */
function swallowNextClick() {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    done();
  };
  const done = () => {
    clearTimeout(timer);
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", done, true);
  };
  const timer = setTimeout(done, 500);
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", done, true);
}
