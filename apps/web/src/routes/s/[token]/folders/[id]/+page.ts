import { loadShared } from "#lib/public.ts";

export const load = async ({ params, fetch, parent }) => {
  await parent();
  return {
    token: params.token,
    view: await loadShared(params.token, { folder: params.id }, fetch),
  };
};
