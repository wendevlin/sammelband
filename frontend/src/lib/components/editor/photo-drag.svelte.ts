/**
 * The photo being dragged in the editor, shared by all galleries so a photo
 * can be dropped into another gallery of the album.
 */
export const photoDrag = $state<{ current: { id: string; blockId: string } | null }>({
  current: null,
});
