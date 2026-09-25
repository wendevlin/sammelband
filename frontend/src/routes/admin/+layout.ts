import { error } from "@sveltejs/kit";
import { auth } from "$lib/stores/auth.svelte";

export const load = async ({ parent }) => {
  await parent();
  if (!auth.isAdmin) error(403, "Admins only");
  return {};
};
