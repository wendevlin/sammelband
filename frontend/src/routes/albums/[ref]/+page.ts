import { redirect } from "@sveltejs/kit";
import { albumPath } from "$lib/links";

// An empty album has nothing to show: go straight to the editor.
export const load = async ({ parent }) => {
  const { album, blocks } = await parent();
  if (blocks.length === 0) redirect(307, albumPath(album, "/edit"));
  return {};
};
