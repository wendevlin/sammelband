import { ApiError, api } from "$lib/api";

export const load = async ({ params, fetch, parent }) => {
  await parent();
  try {
    const invite = await api<{ sammelband: string; role: "admin" | "user" }>(
      `/invites/${params.token}`,
      { fetch },
    );
    return { token: params.token, invite, problem: null };
  } catch (e) {
    return {
      token: params.token,
      invite: null,
      problem: e instanceof ApiError ? e.message : "This invite link doesn't work.",
    };
  }
};
