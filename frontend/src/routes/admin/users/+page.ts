import { load as get } from "$lib/api";
import type { User } from "$lib/types";

export const load = async ({ fetch, depends, parent }) => {
  // Wait for the root layout's auth/onboarding gate before hitting the API.
  await parent();
  depends("app:users");
  return { users: await get<User[]>("/admin/users", fetch) };
};
