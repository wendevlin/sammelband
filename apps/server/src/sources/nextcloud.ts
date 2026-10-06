import type { SourceFolder, SourceImage, SourceListing } from "@sammelband/shared";
import { XMLParser } from "fast-xml-parser";
import { config as appConfig } from "../config";
import { fail } from "../lib/errors";
import { readLimited, remoteFetch } from "../lib/remote-fetch";
import type { PhotoSource, SourceFile } from "./types";

// Nextcloud over WebDAV. Folders and files come from PROPFIND on the user's
// files (/remote.php/dav/files/<user>), previews from /index.php/core/preview,
// accounts are connected with Login Flow v2 (an app password the user grants
// in Nextcloud) or an app password typed in. Locations and refs are paths in
// the user's files, like "/Photos/2024".

export type NextcloudConfig = { url: string };
export type NextcloudCredentials = { loginName: string; appPassword: string; userId: string };

const USER_AGENT = "Sammelband";
/** What imports as it is; other images (HEIC, RAW) import as Nextcloud's large JPEG preview. */
const DIRECT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const LARGE_PREVIEW = 4096;
const MAX_LISTING_BYTES = 8 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;

const auth = (c: NextcloudCredentials) =>
  `Basic ${Buffer.from(`${c.loginName}:${c.appPassword}`).toString("base64")}`;

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const davBase = (config: NextcloudConfig, c: NextcloudCredentials) =>
  `${config.url}/remote.php/dav/files/${encodeURIComponent(c.userId)}`;

/** A path in the user's files: absolute, no "." or ".." segments. */
export function cleanPath(location: string | null): string {
  if (!location || location === "/") return "/";
  const segments = location.split("/").filter(Boolean);
  if (
    location.length > 2000 ||
    !location.startsWith("/") ||
    segments.some((s) => s === "." || s === ".." || [...s].some((ch) => ch.charCodeAt(0) < 32))
  ) {
    throw fail("source_item_not_found");
  }
  return `/${segments.join("/")}`;
}

async function request(url: string, init: RequestInit, c?: NextcloudCredentials) {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  if (c) headers.set("Authorization", auth(c));
  const res = await remoteFetch(url, { ...init, headers });
  if (res.status === 401) throw fail("source_auth_failed");
  return res;
}

/** Checks that `url` is a Nextcloud server; returns it without a trailing slash. */
export async function normalizeUrl(input: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw fail("source_invalid_url");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw fail("source_invalid_url");
  // People paste the address they see in the browser, often with a page behind it.
  const path = url.pathname.replace(/\/(index\.php|apps|login|remote\.php)(\/.*)?$/, "");
  const base = `${url.origin}${path.replace(/\/+$/, "")}`;
  // No login yet: anything but a Nextcloud status (401s included) means "not Nextcloud".
  const res = await remoteFetch(`${base}/status.php`, { headers: { "User-Agent": USER_AGENT } });
  const status = res.ok
    ? ((await res.json().catch(() => null)) as { installed?: boolean } | null)
    : null;
  if (!status?.installed) throw fail("source_not_nextcloud");
  return base;
}

/** The account behind a login name and app password (its id names the WebDAV folder). */
export async function verifyAccount(
  config: NextcloudConfig,
  loginName: string,
  appPassword: string,
): Promise<NextcloudCredentials> {
  const res = await request(
    `${config.url}/ocs/v2.php/cloud/user?format=json`,
    { headers: { "OCS-APIRequest": "true", Accept: "application/json" } },
    { loginName, appPassword, userId: "" },
  );
  if (!res.ok) throw fail("source_unreachable");
  const body = (await res.json().catch(() => null)) as { ocs?: { data?: { id?: string } } } | null;
  const userId = body?.ocs?.data?.id;
  if (!userId) throw fail("source_unreachable");
  return { loginName, appPassword, userId };
}

// --- Login Flow v2 ---------------------------------------------------------------

export type LoginFlow = { login: string; token: string; endpoint: string };

/** Start a login: the user opens `login` and grants access; `pollLogin` then gets an app password. */
export async function startLogin(config: NextcloudConfig): Promise<LoginFlow> {
  const res = await request(`${config.url}/index.php/login/v2`, { method: "POST" });
  const body = (await res.json().catch(() => null)) as {
    login?: string;
    poll?: { token?: string; endpoint?: string };
  } | null;
  if (!res.ok || !body?.login || !body.poll?.token) throw fail("source_unreachable");
  const login = new URL(body.login);
  if (login.protocol !== "https:" && login.protocol !== "http:") throw fail("source_unreachable");
  // Poll the configured server only, whatever address it reports for itself.
  const reported = body.poll.endpoint ? new URL(body.poll.endpoint) : null;
  const endpoint =
    reported && reported.origin === new URL(config.url).origin
      ? reported.href
      : `${config.url}/index.php/login/v2/poll`;
  return { login: login.href, token: body.poll.token, endpoint };
}

/** The granted login, or null while the user hasn't finished in Nextcloud yet. */
export async function pollLogin(
  config: NextcloudConfig,
  flow: LoginFlow,
): Promise<NextcloudCredentials | null> {
  const res = await request(flow.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: flow.token }),
  });
  if (res.status === 404) return null;
  const body = (await res.json().catch(() => null)) as {
    loginName?: string;
    appPassword?: string;
  } | null;
  if (!res.ok || !body?.loginName || !body.appPassword) throw fail("source_unreachable");
  return verifyAccount(config, body.loginName, body.appPassword);
}

// --- Browsing --------------------------------------------------------------------

const PROPFIND = `<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <d:resourcetype/><d:getcontenttype/><d:getcontentlength/><d:getlastmodified/>
    <oc:fileid/><oc:size/><nc:has-preview/>
    <nc:contained-file-count/><nc:contained-folder-count/>
  </d:prop>
</d:propfind>`;

const xml = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === "response" || name === "propstat",
});

type Prop = {
  resourcetype?: { collection?: unknown } | string;
  getcontenttype?: string;
  getcontentlength?: string;
  getlastmodified?: string;
  fileid?: string;
  size?: string;
  "has-preview"?: string;
  "contained-file-count"?: string;
  "contained-folder-count"?: string;
};
type Entry = { path: string; folder: boolean; prop: Prop };

async function propfind(
  config: NextcloudConfig,
  c: NextcloudCredentials,
  path: string,
  depth: 0 | 1,
): Promise<Entry[]> {
  const base = davBase(config, c);
  const res = await request(
    `${base}${encodePath(path)}`,
    {
      method: "PROPFIND",
      headers: { Depth: String(depth), "Content-Type": "application/xml; charset=utf-8" },
      body: PROPFIND,
    },
    c,
  );
  if (res.status === 404) throw fail("source_item_not_found");
  if (res.status !== 207) throw fail("source_unreachable");
  const text = new TextDecoder().decode(await readLimited(res, MAX_LISTING_BYTES));
  const doc = xml.parse(text) as {
    multistatus?: { response?: { href?: string; propstat?: { prop?: Prop; status?: string }[] }[] };
  };
  const prefix = decodeURIComponent(new URL(base).pathname);
  return (doc.multistatus?.response ?? []).flatMap((r) => {
    const href = decodeURIComponent(r.href ?? "");
    if (!href.startsWith(prefix)) return [];
    const ok = r.propstat?.find((p) => p.status?.includes(" 200 "))?.prop ?? {};
    const rt = ok.resourcetype;
    const folder = typeof rt === "object" && rt !== null && "collection" in rt;
    const entryPath = `/${href.slice(prefix.length).split("/").filter(Boolean).join("/")}`;
    return [{ path: entryPath, folder, prop: ok }];
  });
}

/** A number property, or null when the server didn't send one. */
const count = (value: string | undefined) => {
  const n = value === undefined || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const date = (value: string | undefined) => {
  const t = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};

const baseName = (path: string) => path.split("/").filter(Boolean).at(-1) ?? "";
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

async function browse(
  config: NextcloudConfig,
  c: NextcloudCredentials,
  location: string | null,
): Promise<SourceListing> {
  const path = cleanPath(location);
  const entries = await propfind(config, c, path, 1);
  const folders: SourceFolder[] = [];
  const images: SourceImage[] = [];
  for (const e of entries) {
    if (e.path === path) continue;
    const name = baseName(e.path);
    if (name.startsWith(".")) continue;
    if (e.folder) {
      // Counts need Nextcloud 28 or newer; older ones send the size only.
      folders.push({
        ref: e.path,
        name,
        files: count(e.prop["contained-file-count"]),
        folders: count(e.prop["contained-folder-count"]),
        size: count(e.prop.size),
        modified: date(e.prop.getlastmodified),
      });
      continue;
    }
    const type = e.prop.getcontenttype ?? "";
    const preview = e.prop["has-preview"] === "true";
    if (!type.startsWith("image/") || (!DIRECT_TYPES.has(type) && !preview)) continue;
    images.push({
      ref: e.path,
      name,
      thumb: preview && e.prop.fileid ? e.prop.fileid : null,
      size: count(e.prop.getcontentlength),
      modified: date(e.prop.getlastmodified),
    });
  }
  const segments = path.split("/").filter(Boolean);
  const crumbs = [
    { ref: "/", name: "" },
    ...segments.map((name, i) => ({ ref: `/${segments.slice(0, i + 1).join("/")}`, name })),
  ];
  return { location: path, crumbs, folders: folders.sort(byName), images: images.sort(byName) };
}

async function preview(
  config: NextcloudConfig,
  c: NextcloudCredentials,
  fileId: string,
  size: number,
  max: number,
): Promise<SourceFile> {
  if (!/^\d+$/.test(fileId)) throw fail("source_item_not_found");
  const params = new URLSearchParams({
    fileId,
    x: String(size),
    y: String(size),
    a: "1",
    forceIcon: "0",
  });
  const res = await request(`${config.url}/index.php/core/preview?${params}`, {}, c);
  if (res.status === 404) throw fail("source_item_not_found");
  if (!res.ok) throw fail("source_unreachable");
  return {
    bytes: await readLimited(res, max),
    name: `${fileId}.jpg`,
    type: res.headers.get("content-type") ?? "image/jpeg",
  };
}

async function download(
  config: NextcloudConfig,
  c: NextcloudCredentials,
  ref: string,
): Promise<SourceFile> {
  const path = cleanPath(ref);
  if (path === "/") throw fail("source_item_not_found");
  const [entry] = await propfind(config, c, path, 0);
  if (!entry || entry.folder) throw fail("source_item_not_found");
  const type = entry.prop.getcontenttype ?? "";
  const name = baseName(path);
  if (!DIRECT_TYPES.has(type)) {
    // HEIC and the like: Nextcloud's largest preview is a JPEG we can store.
    if (entry.prop["has-preview"] !== "true" || !entry.prop.fileid) throw fail("only_images");
    const large = await preview(
      config,
      c,
      entry.prop.fileid,
      LARGE_PREVIEW,
      appConfig.MAX_UPLOAD_BYTES,
    );
    return { ...large, name: `${name.replace(/\.[^.]+$/, "")}.jpg` };
  }
  const res = await request(`${davBase(config, c)}${encodePath(path)}`, {}, c);
  if (res.status === 404) throw fail("source_item_not_found");
  if (!res.ok) throw fail("source_unreachable");
  return { bytes: await readLimited(res, appConfig.MAX_UPLOAD_BYTES), name, type };
}

export const nextcloud: PhotoSource<NextcloudConfig, NextcloudCredentials> = {
  id: "nextcloud",
  name: "Nextcloud",
  async parseConfig(input) {
    if (typeof input.url !== "string" || !input.url.trim()) throw fail("source_invalid_url");
    return { url: await normalizeUrl(input.url) };
  },
  showConfig: (config) => ({ url: config.url }),
  serverOf: (config) => config.url,
  browse,
  thumbnail: (config, c, thumb, size) => preview(config, c, thumb, size, MAX_THUMBNAIL_BYTES),
  download,
  async revoke(config, c) {
    // Deletes the app password this account used (a no-op for regular passwords).
    await request(
      `${config.url}/ocs/v2.php/core/apppassword`,
      { method: "DELETE", headers: { "OCS-APIRequest": "true" } },
      c,
    ).catch(() => undefined);
  },
};
