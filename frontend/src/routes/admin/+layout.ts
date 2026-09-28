import { error } from "@sveltejs/kit";
import { m } from "$lib/paraglide/messages.js";
import { auth } from "$lib/stores/auth.svelte";

export const load = async ({ parent }) => {
  await parent();
  if (!auth.isAdmin) error(403, m.error_forbidden());
  return {};
};
