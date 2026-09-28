/**
 * Scroll the page while something is dragged near the top or bottom edge:
 * browsers don't reliably do it for HTML5 drag and drop. Faster the closer
 * the pointer gets to the edge. Returns a cleanup function.
 */
export function dragAutoscroll(edge = 90, maxSpeed = 22): () => void {
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
  const onDragOver = (e: DragEvent) => {
    y = e.clientY;
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    y = null;
    cancelAnimationFrame(frame);
    frame = 0;
  };

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
