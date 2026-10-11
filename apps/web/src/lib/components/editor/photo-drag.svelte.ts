/**
 * The photo being dragged in the editor, shared by all sections so a photo
 * can be dropped into another section of the album.
 *
 * Mouse drags are HTML5 drag and drop: each section sees its own dragover
 * events. Touch drags (`touch-drag.ts`) only know the point under the finger,
 * so `target` says where it is, each section shows it when it's one of its
 * own, and the section it belongs to does the drop (`dropPhoto`).
 */
export type PhotoDropTarget = {
  /** The section's gallery, from `data-drop-gallery`. */
  gallery: string;
  /** Before or after this photo; null for the end of the section (its upload zone). */
  id: string | null;
  after: boolean;
};

export const photoDrag = $state<{
  current: { id: string; sectionId: string } | null;
  /** Touch drags: what is under the finger. */
  target: PhotoDropTarget | null;
}>({
  current: null,
  target: null,
});

const galleries = new Map<string, (target: PhotoDropTarget) => void>();

/** A section's gallery takes touch drops as `key`. Returns the cleanup. */
export function registerGallery(key: string, drop: (target: PhotoDropTarget) => void) {
  galleries.set(key, drop);
  return () => {
    galleries.delete(key);
  };
}

/**
 * The drop target at a point in the viewport: an element with
 * `data-drop-gallery`, either a photo (`data-drop-photo`, before or after it
 * by the half) or a gallery's upload zone. Not the dragged photo itself.
 */
export function photoTargetAt(x: number, y: number): PhotoDropTarget | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-gallery]");
  const gallery = el?.dataset.dropGallery;
  if (!el || !gallery || !photoDrag.current) return null;
  const id = el.dataset.dropPhoto ?? null;
  if (id === photoDrag.current.id) return null;
  const rect = el.getBoundingClientRect();
  return { gallery, id, after: id !== null && x > rect.left + rect.width / 2 };
}

/** Drop the dragged photo where a touch drag let go of it. */
export function dropPhoto(target: PhotoDropTarget): void {
  galleries.get(target.gallery)?.(target);
}
