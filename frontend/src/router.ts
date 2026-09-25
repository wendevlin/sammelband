/**
 * Tiny history-API router. Routes are matched with a regex against the path.
 * Designed to be consumed by a single root component that re-renders on change.
 */

export type Route =
  | { name: "login" }
  | { name: "home" }
  | { name: "folder"; id: string }
  | { name: "album"; id: string }
  | { name: "share"; token: string }
  | { name: "admin-home" }
  | { name: "admin-album"; id: string }
  | { name: "admin-storage" }
  | { name: "admin-users" }
  | { name: "not-found" };

const PATTERNS: { test: RegExp; build: (m: RegExpMatchArray) => Route }[] = [
  { test: /^\/login\/?$/, build: () => ({ name: "login" }) },
  // Admin patterns first so /admin doesn't match /albums/:slug-like generic patterns.
  { test: /^\/admin\/?$/, build: () => ({ name: "admin-home" }) },
  {
    test: /^\/admin\/albums\/([^/]+)\/?$/,
    build: (m) => ({ name: "admin-album", id: m[1]! }),
  },
  { test: /^\/admin\/storage\/?$/, build: () => ({ name: "admin-storage" }) },
  { test: /^\/admin\/users\/?$/, build: () => ({ name: "admin-users" }) },
  { test: /^\/(home)?\/?$/, build: () => ({ name: "home" }) },
  {
    test: /^\/folders\/([^/]+)\/?$/,
    build: (m) => ({ name: "folder", id: m[1]! }),
  },
  {
    test: /^\/albums\/([^/]+)\/?$/,
    build: (m) => ({ name: "album", id: m[1]! }),
  },
  {
    test: /^\/share\/([^/]+)\/?$/,
    build: (m) => ({ name: "share", token: m[1]! }),
  },
];

export function parseRoute(pathname: string): Route {
  for (const { test, build } of PATTERNS) {
    const m = pathname.match(test);
    if (m) return build(m);
  }
  return { name: "not-found" };
}

export function navigate(to: string): void {
  if (location.pathname === to) return;
  history.pushState({}, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}
