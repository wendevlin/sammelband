import { redirect } from "@sveltejs/kit";
import { loginUrl, safeNext } from "$lib/api";
import { auth } from "$lib/stores/auth.svelte";

// Pure client-side SPA served by the Bun backend.
export const ssr = false;
export const prerender = false;

const PUBLIC_PATHS = new Set(["/login"]);

export const load = async ({ url }) => {
  await auth.init();
  if (auth.needsOnboarding) return {};
  if (!auth.user && !PUBLIC_PATHS.has(url.pathname)) redirect(307, loginUrl(url));
  if (auth.user && url.pathname === "/login") redirect(307, safeNext(url));
  return {};
};
