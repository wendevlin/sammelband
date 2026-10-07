import { redirect } from "@sveltejs/kit";
import { albumPath } from "#lib/links.ts";

// An empty album has nothing to show: go straight to the editor.
export const load = async ({ parent }) => {
  const { album, sections } = await parent();
  if (sections.length === 0) redirect(307, albumPath(album, "/edit"));
  return {};
};
