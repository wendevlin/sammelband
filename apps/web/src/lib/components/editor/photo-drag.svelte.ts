/**
 * The photo being dragged in the editor, shared by all sections so a photo
 * can be dropped into another section of the album.
 */
export const photoDrag = $state<{ current: { id: string; sectionId: string } | null }>({
  current: null,
});
