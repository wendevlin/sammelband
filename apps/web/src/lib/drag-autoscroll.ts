/**
 * Scroll the page while a pointer is near its top or bottom edge, faster the
 * closer it gets. `move` with each new pointer position, `stop` when the drag
 * ends.
 */
export function edgeAutoscroll(edge = 90, maxSpeed = 22) {
  let y: number | null = null;
  let frame = 0;

  const tick = () => {
    if (y !== null) {
      const fromTop = y;
      const fromBottom = window.innerHeight - y;
      if (fromTop < edge) window.scrollBy(0, -maxSpeed * (1 - fromTop / edge));
      else if (fromBottom < edge) window.scrollBy(0, maxSpeed * (1 - fromBottom / edge));
    }
    frame = requestAnimationFrame(tick);
  };
  return {
    move(clientY: number) {
      y = clientY;
      if (!frame) frame = requestAnimationFrame(tick);
    },
    stop() {
      y = null;
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

/**
 * Scroll the page while something is dragged near the top or bottom edge:
 * browsers don't reliably do it for HTML5 drag and drop. Returns a cleanup
 * function.
 */
export function dragAutoscroll(edge = 90, maxSpeed = 22): () => void {
  const scroller = edgeAutoscroll(edge, maxSpeed);
  const onDragOver = (e: DragEvent) => scroller.move(e.clientY);
  const stop = () => scroller.stop();

  document.addEventListener("dragover", onDragOver);
  document.addEventListener("dragend", stop);
  document.addEventListener("drop", stop);
  return () => {
    stop();
    document.removeEventListener("dragover", onDragOver);
    document.removeEventListener("dragend", stop);
    document.removeEventListener("drop", stop);
  };
}
