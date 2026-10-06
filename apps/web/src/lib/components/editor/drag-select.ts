import type { Attachment } from "svelte/attachments";

/**
 * Select several items by dragging over them, like in a file browser. Items
 * are elements with `data-select-key` inside the scrolling element this is
 * attached to (which needs `position: relative`).
 *
 * - Mouse: drag a rectangle; everything it touches gets selected. Starting on
 *   a selected item deselects instead.
 * - Touch and pen: press and hold an item, then slide over others to select
 *   the range in between (like Google Photos). A quick swipe still scrolls.
 *
 * The edges scroll while dragging near them. A drag never counts as a click.
 */
export type DragSelectOptions = {
  isSelected: (key: string) => boolean;
  /** Called for each item whose state the drag changes (or changes back). */
  set: (key: string, on: boolean) => void;
};

const MOUSE_THRESHOLD = 6;
const TOUCH_SLOP = 10;
const LONG_PRESS_MS = 350;
const EDGE = 48;
const MAX_SCROLL_STEP = 18;

type Drag = {
  pointer: number;
  touch: boolean;
  /** In content coordinates (scroll included). */
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  startKey: string | null;
  /** The selection before the drag, for the items it leaves again. */
  before: Map<string, boolean>;
  on: boolean;
  active: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export function dragSelect(options: DragSelectOptions): Attachment<HTMLElement> {
  return (container) => {
    let drag: Drag | null = null;
    let suppressClick = false;
    let frame = 0;
    const box = document.createElement("div");
    box.className =
      "pointer-events-none absolute z-10 hidden rounded-sm border border-primary bg-primary/15";
    container.append(box);

    const items = () => [...container.querySelectorAll<HTMLElement>("[data-select-key]")];
    const keyOf = (el: Element | null) =>
      el?.closest<HTMLElement>("[data-select-key]")?.dataset.selectKey ?? null;
    const origin = () => {
      const r = container.getBoundingClientRect();
      return {
        x: r.left + container.clientLeft - container.scrollLeft,
        y: r.top + container.clientTop - container.scrollTop,
      };
    };

    function apply(want: (el: HTMLElement, key: string, index: number) => boolean) {
      if (!drag) return;
      items().forEach((el, i) => {
        const key = el.dataset.selectKey as string;
        if (!drag) return;
        if (!drag.before.has(key)) drag.before.set(key, options.isSelected(key));
        const target = want(el, key, i) ? drag.on : (drag.before.get(key) as boolean);
        if (options.isSelected(key) !== target) options.set(key, target);
      });
    }

    function update() {
      if (!drag?.active) return;
      const o = origin();
      if (drag.touch) {
        const key = keyOf(document.elementFromPoint(drag.clientX, drag.clientY));
        if (!key) return;
        const keys = items().map((el) => el.dataset.selectKey);
        const a = keys.indexOf(drag.startKey ?? "");
        const b = keys.indexOf(key);
        if (a < 0 || b < 0) return;
        const [from, to] = a < b ? [a, b] : [b, a];
        apply((_, __, i) => i >= from && i <= to);
        return;
      }
      const x = drag.clientX - o.x;
      const y = drag.clientY - o.y;
      const left = Math.min(drag.startX, x);
      const top = Math.min(drag.startY, y);
      const right = Math.max(drag.startX, x);
      const bottom = Math.max(drag.startY, y);
      Object.assign(box.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
      });
      box.classList.remove("hidden");
      apply((el) => {
        const r = el.getBoundingClientRect();
        const l = r.left - o.x;
        const t = r.top - o.y;
        return l < right && l + r.width > left && t < bottom && t + r.height > top;
      });
    }

    // Scroll while the pointer is near the top or bottom edge.
    function autoScroll() {
      frame = 0;
      if (!drag?.active) return;
      const r = container.getBoundingClientRect();
      let step = 0;
      if (drag.clientY < r.top + EDGE) step = -((r.top + EDGE - drag.clientY) / EDGE);
      else if (drag.clientY > r.bottom - EDGE) step = (drag.clientY - (r.bottom - EDGE)) / EDGE;
      if (step === 0) return;
      container.scrollTop += Math.max(-1, Math.min(1, step)) * MAX_SCROLL_STEP;
      update();
      frame = requestAnimationFrame(autoScroll);
    }

    function start() {
      if (!drag) return;
      drag.active = true;
      drag.on = !(drag.startKey && options.isSelected(drag.startKey));
      if (drag.touch) navigator.vibrate?.(10);
      update();
    }

    function end() {
      if (!drag) return;
      clearTimeout(drag.timer);
      if (drag.active) {
        suppressClick = true;
        setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
      if (container.hasPointerCapture(drag.pointer)) container.releasePointerCapture(drag.pointer);
      drag = null;
      box.classList.add("hidden");
      cancelAnimationFrame(frame);
      frame = 0;
    }

    function down(e: PointerEvent) {
      if (drag || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("[data-no-drag-select]")) return;
      const touch = e.pointerType !== "mouse";
      const startKey = keyOf(target);
      // Touch drags start on an item; mouse drags anywhere but on a scrollbar.
      if (touch && !startKey) return;
      if (
        !touch &&
        target === container &&
        (e.offsetX >= container.clientWidth || e.offsetY >= container.clientHeight)
      )
        return;
      const o = origin();
      drag = {
        pointer: e.pointerId,
        touch,
        startX: e.clientX - o.x,
        startY: e.clientY - o.y,
        clientX: e.clientX,
        clientY: e.clientY,
        startKey,
        before: new Map(),
        on: true,
        active: false,
      };
      if (touch) drag.timer = setTimeout(start, LONG_PRESS_MS);
    }

    function move(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.pointer) return;
      const o = origin();
      const dx = e.clientX - o.x - drag.startX;
      const dy = e.clientY - o.y - drag.startY;
      drag.clientX = e.clientX;
      drag.clientY = e.clientY;
      if (!drag.active) {
        if (drag.touch) {
          // Moved before the long press: the user is scrolling.
          if (Math.hypot(dx, dy) > TOUCH_SLOP) end();
          return;
        }
        if (Math.hypot(dx, dy) < MOUSE_THRESHOLD) return;
        container.setPointerCapture(e.pointerId);
        start();
      }
      e.preventDefault();
      update();
      if (!frame) frame = requestAnimationFrame(autoScroll);
    }

    // Once a touch drag runs, the finger selects instead of scrolling.
    function touchMove(e: TouchEvent) {
      if (drag?.active && e.cancelable) e.preventDefault();
    }
    function click(e: MouseEvent) {
      if (!suppressClick) return;
      e.preventDefault();
      e.stopPropagation();
      suppressClick = false;
    }
    // No long-press menu (save image, …) on the items.
    function contextMenu(e: Event) {
      if (drag || keyOf(e.target as Element)) e.preventDefault();
    }
    function scroll() {
      update();
    }
    // Native image dragging would end the pointer events.
    function dragStart(e: DragEvent) {
      e.preventDefault();
    }

    container.addEventListener("pointerdown", down);
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerup", end);
    container.addEventListener("pointercancel", end);
    container.addEventListener("touchmove", touchMove, { passive: false });
    container.addEventListener("click", click, true);
    container.addEventListener("contextmenu", contextMenu);
    container.addEventListener("scroll", scroll, { passive: true });
    container.addEventListener("dragstart", dragStart);
    return () => {
      end();
      box.remove();
      container.removeEventListener("pointerdown", down);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerup", end);
      container.removeEventListener("pointercancel", end);
      container.removeEventListener("touchmove", touchMove);
      container.removeEventListener("click", click, true);
      container.removeEventListener("contextmenu", contextMenu);
      container.removeEventListener("scroll", scroll);
      container.removeEventListener("dragstart", dragStart);
    };
  };
}
