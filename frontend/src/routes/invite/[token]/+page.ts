import { ApiError, api } from "$lib/api";
import { errorText } from "$lib/i18n";
import { m } from "$lib/paraglide/messages.js";

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
      problem: e instanceof ApiError ? errorText(e) : m.error_invite_invalid(),
    };
  }
};
