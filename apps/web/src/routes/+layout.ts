import { redirect } from "@sveltejs/kit";
import { loginUrl, safeNext } from "$lib/api";
import { auth } from "$lib/stores/auth.svelte";

// Pure client-side SPA served by the Bun backend.
export const ssr = false;
export const prerender = false;

const TWO_FACTOR_SETUP = "/two-factor";

const isPublic = (path: string) =>
  path === "/login" ||
  path === "/forgot-password" ||
  path === "/reset-password" ||
  path.startsWith("/invite/") ||
  path.startsWith("/s/");

export const load = async ({ url }) => {
  await auth.init();
  if (auth.needsOnboarding) return {};
  if (!auth.user && !isPublic(url.pathname)) redirect(307, loginUrl(url));
  if (auth.user && url.pathname === "/login") redirect(307, safeNext(url));
  // Where two-factor authentication is required, set it up before anything else.
  const setup = url.pathname === TWO_FACTOR_SETUP;
  if (auth.needsTwoFactorSetup && !setup && !isPublic(url.pathname)) {
    redirect(307, `${TWO_FACTOR_SETUP}?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  if (setup && !auth.needsTwoFactorSetup) redirect(307, safeNext(url));
  return {};
};
