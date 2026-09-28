import { error } from "@sveltejs/kit";
import { load as get } from "$lib/api";
import { auth } from "$lib/stores/auth.svelte";
import type { InstanceOverview } from "$lib/types";

export const load = async ({ fetch, depends, parent }) => {
  await parent();
  if (!auth.multiTenant) error(404, "Multiple Sammelbände are not enabled on this server");
  if (!auth.isSuperadmin) error(403, "Only the instance owner can manage Sammelbände");
  depends("app:instance");
  return { overview: await get<InstanceOverview>("/instance", fetch) };
};
