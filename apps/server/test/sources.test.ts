import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { classifyAddress } from "../src/lib/remote-fetch";
import { open, seal } from "../src/lib/secret-box";
import { runInTenant } from "../src/lib/tenant-context";
import * as albumService from "../src/services/album.service";
import * as imageService from "../src/services/image.service";
import * as sectionService from "../src/services/section.service";
import * as sourceService from "../src/services/source.service";
import {
  cleanPath,
  type NextcloudConfig,
  pollLogin,
  startLogin,
  verifyAccount,
} from "../src/sources/nextcloud";
import { createTenant, createUser, inTenant, png } from "./helpers";

// A small stand-in for Nextcloud: status, OCS user, WebDAV PROPFIND/GET,
// previews and Login Flow v2, for one user "anna" with app password "secret".

const jpeg = async (rgb: [number, number, number]) =>
  new Uint8Array(await new Bun.Image(Buffer.from(await png(rgb).arrayBuffer())).jpeg().bytes());

type FakeFile = {
  path: string;
  type?: string;
  bytes?: Uint8Array<ArrayBuffer>;
  id: number;
  preview?: boolean;
};
let files: FakeFile[] = [];
let granted = false;
const revoked: string[] = [];

function propResponse(base: string, f: FakeFile) {
  const href = `${base}${f.path.split("/").map(encodeURIComponent).join("/")}${f.type ? "" : "/"}`;
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>
    <d:resourcetype>${f.type ? "" : "<d:collection/>"}</d:resourcetype>
    ${f.type ? `<d:getcontenttype>${f.type}</d:getcontenttype><d:getcontentlength>${f.bytes?.byteLength ?? 0}</d:getcontentlength>` : ""}
    <d:getlastmodified>Fri, 02 Oct 2026 06:43:20 GMT</d:getlastmodified>
    <oc:fileid>${f.id}</oc:fileid><nc:has-preview>${f.preview ? "true" : "false"}</nc:has-preview>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

let server: ReturnType<typeof Bun.serve>;
let other: ReturnType<typeof Bun.serve>;
let url = "";
let otherUrl = "";

beforeAll(async () => {
  const fetch = async (req: Request) => {
    {
      const u = new URL(req.url);
      const authed =
        req.headers.get("authorization") ===
        `Basic ${Buffer.from("anna:secret").toString("base64")}`;
      if (u.pathname === "/nc/status.php") return Response.json({ installed: true });
      if (u.pathname === "/nc/index.php/login/v2" && req.method === "POST") {
        return Response.json({
          poll: { token: "tok", endpoint: `${url}/login/v2/poll` },
          login: `${url}/login/v2/flow/abc`,
        });
      }
      if (u.pathname === "/nc/login/v2/poll" || u.pathname === "/nc/index.php/login/v2/poll") {
        const body = new URLSearchParams(await req.text());
        if (body.get("token") !== "tok" || !granted) return new Response(null, { status: 404 });
        return Response.json({ server: url, loginName: "anna", appPassword: "secret" });
      }
      if (!authed) return new Response(null, { status: 401 });
      if (u.pathname === "/nc/ocs/v2.php/cloud/user")
        return Response.json({ ocs: { data: { id: "anna" } } });
      if (u.pathname === "/nc/ocs/v2.php/core/apppassword" && req.method === "DELETE") {
        revoked.push("anna");
        return Response.json({});
      }
      if (u.pathname === "/nc/index.php/core/preview") {
        const f = files.find((x) => String(x.id) === u.searchParams.get("fileId") && x.preview);
        return f
          ? new Response(await jpeg([0, 128, 0]), { headers: { "Content-Type": "image/jpeg" } })
          : new Response(null, { status: 404 });
      }
      const dav = "/nc/remote.php/dav/files/anna";
      if (u.pathname.startsWith(dav)) {
        const path = `/${decodeURIComponent(u.pathname.slice(dav.length)).split("/").filter(Boolean).join("/")}`;
        const self = path === "/" ? { path: "/", id: 1 } : files.find((f) => f.path === path);
        if (!self) return new Response(null, { status: 404 });
        if (req.method === "GET")
          return new Response(self.bytes, { headers: { "Content-Type": self.type ?? "" } });
        const depth = req.headers.get("depth");
        const prefix = path === "/" ? "/" : `${path}/`;
        const children =
          depth === "1"
            ? files.filter(
                (f) => f.path.startsWith(prefix) && !f.path.slice(prefix.length).includes("/"),
              )
            : [];
        const body = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">${[self, ...children].map((f) => propResponse(dav, f)).join("")}</d:multistatus>`;
        return new Response(body, { status: 207, headers: { "Content-Type": "application/xml" } });
      }
      return new Response(null, { status: 404 });
    }
  };
  server = Bun.serve({ port: 0, fetch });
  other = Bun.serve({ port: 0, fetch });
  url = `http://localhost:${server.port}/nc`;
  otherUrl = `http://localhost:${other.port}/nc`;
  files = [
    { path: "/Photos", id: 2 },
    { path: "/Photos/Lisbon", id: 3 },
    {
      path: "/Photos/Lisbon/IMG_2.jpg",
      type: "image/jpeg",
      bytes: await jpeg([255, 0, 0]),
      id: 10,
      preview: true,
    },
    {
      path: "/Photos/Lisbon/IMG_10.jpg",
      type: "image/jpeg",
      bytes: await jpeg([0, 0, 255]),
      id: 11,
      preview: true,
    },
    {
      path: "/Photos/Lisbon/live.heic",
      type: "image/heic",
      bytes: new Uint8Array([1, 2, 3]),
      id: 12,
      preview: true,
    },
    {
      path: "/Photos/Lisbon/raw.cr3",
      type: "image/x-canon-cr3",
      bytes: new Uint8Array([1]),
      id: 13,
    },
    { path: "/Photos/Lisbon/notes.md", type: "text/markdown", bytes: new Uint8Array([1]), id: 14 },
    { path: "/Photos/Lisbon/.hidden.jpg", type: "image/jpeg", bytes: new Uint8Array([1]), id: 15 },
  ];
});
afterAll(() => {
  server.stop(true);
  other.stop(true);
});

/** Nextcloud on (default: the fake server), and a user with a connected account. */
async function connected(name: string | null = null) {
  const user = await createUser("admin");
  await sourceService.saveSettings("nextcloud", {
    enabled: true,
    config: { url: `${url}/index.php/apps/files` },
  });
  const config = await sourceService.configFor<NextcloudConfig>("nextcloud");
  const credentials = await verifyAccount(config, "anna", "secret");
  const account = await sourceService.addAccount(user.id, "nextcloud", {
    name,
    label: "anna",
    config,
    credentials,
  });
  return { user, account };
}

describe("photo sources", () => {
  test("addresses: link-local and metadata never, private networks as configured", () => {
    expect(classifyAddress("169.254.169.254")).toBe("blocked");
    expect(classifyAddress("0.0.0.0")).toBe("blocked");
    expect(classifyAddress("fe80::1")).toBe("blocked");
    expect(classifyAddress("::ffff:169.254.1.1")).toBe("blocked");
    expect(classifyAddress("192.168.1.10")).toBe("private");
    expect(classifyAddress("100.100.1.1")).toBe("private");
    expect(classifyAddress("127.0.0.1")).toBe("private");
    expect(classifyAddress("fd00::1")).toBe("private");
    expect(classifyAddress("93.184.216.34")).toBe("public");
    expect(classifyAddress("2a01:4f8::1")).toBe("public");
  });

  test("credentials are sealed; a damaged value doesn't open", async () => {
    const sealed = await seal({ appPassword: "secret" });
    expect(sealed).not.toContain("secret");
    expect(await open<{ appPassword: string }>(sealed)).toEqual({ appPassword: "secret" });
    expect(await open(`${sealed.slice(0, -4)}AAAA`)).toBeNull();
  });

  test("paths stay inside the user's files", () => {
    expect(cleanPath(null)).toBe("/");
    expect(cleanPath("/Photos//Lisbon/")).toBe("/Photos/Lisbon");
    expect(() => cleanPath("/Photos/../../etc")).toThrow("Not found");
    expect(() => cleanPath("Photos")).toThrow("Not found");
  });

  test(
    "admins switch Nextcloud on; a default server is optional, checked and normalized",
    inTenant(async () => {
      const user = await createUser();
      expect(await sourceService.listForUser(user.id)).toEqual([]);
      await expect(
        sourceService.saveSettings("nextcloud", { enabled: true, config: { url: "ftp://x" } }),
      ).rejects.toThrow("address of the server");
      await expect(
        sourceService.saveSettings("nextcloud", { enabled: true, config: { url: `${url}/nope` } }),
      ).rejects.toThrow("No Nextcloud");
      // On without a default: everyone brings their own server.
      await sourceService.saveSettings("nextcloud", { enabled: true, config: {} });
      expect(await sourceService.listForUser(user.id)).toEqual([
        { id: "nextcloud", name: "Nextcloud", default_server: null, accounts: [] },
      ]);
      await expect(sourceService.configFor("nextcloud")).rejects.toThrow("address of the server");
      const saved = await sourceService.saveSettings("nextcloud", {
        enabled: true,
        config: { url: `${url}/index.php/apps/files/` },
      });
      expect(saved).toMatchObject({ enabled: true, config: { url }, accounts: 0 });
      expect((await sourceService.listForUser(user.id))[0]?.default_server).toBe(url);
    }),
  );

  test(
    "several accounts, on the default or another server, with optional names",
    inTenant(async () => {
      const { user, account } = await connected();
      expect(account).toMatchObject({ name: null, label: "anna", server: url });
      const config = await sourceService.configFor<NextcloudConfig>("nextcloud", {
        url: `${otherUrl}/`,
      });
      expect(config.url).toBe(otherUrl);
      const work = await sourceService.addAccount(user.id, "nextcloud", {
        name: "  Work  ",
        label: "anna",
        config,
        credentials: await verifyAccount(config, "anna", "secret"),
      });
      expect(work).toMatchObject({ name: "Work", server: otherUrl });
      expect((await sourceService.listForUser(user.id))[0]?.accounts.map((a) => a.id)).toEqual([
        account.id,
        work.id,
      ]);
      // Both work, each with its own remembered folder.
      await sourceService.browse(user.id, work.id, "/Photos");
      expect((await sourceService.browse(user.id, account.id, null)).location).toBe("/");
      expect((await sourceService.browse(user.id, work.id, null)).location).toBe("/Photos");

      expect((await sourceService.renameAccount(user.id, account.id, "Family")).name).toBe(
        "Family",
      );
      expect((await sourceService.renameAccount(user.id, account.id, " ")).name).toBeNull();
      // Changing the default server leaves existing accounts alone.
      await sourceService.saveSettings("nextcloud", { enabled: true, config: { url: otherUrl } });
      expect((await sourceService.listForUser(user.id))[0]?.accounts).toHaveLength(2);
      // Someone else's account is "not found".
      const stranger = await createUser();
      await expect(sourceService.browse(stranger.id, work.id, null)).rejects.toThrow(
        "isn't connected",
      );
      await expect(sourceService.removeAccount(stranger.id, work.id)).rejects.toThrow(
        "isn't connected",
      );
    }),
  );

  test(
    "browsing lists folders and importable images, and remembers where it was",
    inTenant(async () => {
      const { user, account } = await connected();
      const top = await sourceService.browse(user.id, account.id, null);
      expect(top.location).toBe("/");
      expect(top.folders).toEqual([{ ref: "/Photos", name: "Photos" }]);

      const lisbon = await sourceService.browse(user.id, account.id, "/Photos/Lisbon");
      expect(lisbon.crumbs.map((c) => c.ref)).toEqual(["/", "/Photos", "/Photos/Lisbon"]);
      // Natural order; HEIC with a preview counts, RAW without one, text and hidden files don't.
      expect(lisbon.images.map((i) => i.name)).toEqual(["IMG_2.jpg", "IMG_10.jpg", "live.heic"]);
      expect(lisbon.images[0]).toMatchObject({ ref: "/Photos/Lisbon/IMG_2.jpg", thumb: "10" });

      // Opening the picker again starts in the last folder…
      expect((await sourceService.browse(user.id, account.id, null)).location).toBe(
        "/Photos/Lisbon",
      );
      // …unless it's gone.
      files = files.map((f) =>
        f.path === "/Photos/Lisbon" ? { ...f, path: "/Photos/Lissabon" } : f,
      );
      expect((await sourceService.browse(user.id, account.id, null)).location).toBe("/");
      files = files.map((f) =>
        f.path === "/Photos/Lissabon" ? { ...f, path: "/Photos/Lisbon" } : f,
      );
      await expect(sourceService.browse(user.id, account.id, "/Photos/Missing")).rejects.toThrow(
        "Not found",
      );

      const thumb = await sourceService.thumbnail(user.id, account.id, "10", 256);
      expect(thumb.type).toBe("image/jpeg");
      await expect(sourceService.thumbnail(user.id, account.id, "../1", 256)).rejects.toThrow(
        "Not found",
      );
    }),
  );

  test(
    "importing stores photos like uploads; HEIC comes in as Nextcloud's JPEG",
    inTenant(async () => {
      const { user, account } = await connected();
      const album = await albumService.createAlbum({
        title: "A",
        folderId: null,
        createdBy: user.id,
      });
      const section = await sectionService.createSection({ albumId: album.id });
      const imported = await sourceService.importPhotos(user.id, account.id, section.id, [
        "/Photos/Lisbon/IMG_10.jpg",
        "/Photos/Lisbon/live.heic",
      ]);
      expect(imported).toHaveLength(2);
      const photos = await imageService.photosWithImage({ sectionId: section.id });
      expect(photos.map((p) => p.id)).toEqual(imported.map((i) => i.photo.id));
      // Same picture again: deduplicated like an upload.
      const again = await sourceService.importPhotos(user.id, account.id, section.id, [
        "/Photos/Lisbon/IMG_10.jpg",
      ]);
      expect(again[0]?.deduplicated).toBe(true);
      await expect(
        sourceService.importPhotos(user.id, account.id, section.id, ["/Photos/Lisbon/notes.md"]),
      ).rejects.toThrow("Only images");
      await expect(
        sourceService.importPhotos(user.id, account.id, "nope", ["/Photos/Lisbon/IMG_10.jpg"]),
      ).rejects.toThrow("Section not found");
    }),
  );

  test(
    "Login Flow v2: pending until the user grants access; polls the configured server only",
    inTenant(async () => {
      await sourceService.saveSettings("nextcloud", { enabled: true, config: { url } });
      const config = await sourceService.configFor<NextcloudConfig>("nextcloud");
      granted = false;
      const flow = await startLogin(config);
      expect(flow.login).toBe(`${url}/login/v2/flow/abc`);
      expect(await pollLogin(config, flow)).toBeNull();
      granted = true;
      expect(await pollLogin(config, flow)).toEqual({
        loginName: "anna",
        appPassword: "secret",
        userId: "anna",
      });
      await expect(verifyAccount(config, "anna", "wrong")).rejects.toThrow("didn't accept");
      // The other server reports the first one's poll address: not followed.
      const otherConfig = await sourceService.configFor<NextcloudConfig>("nextcloud", {
        url: otherUrl,
      });
      expect((await startLogin(otherConfig)).endpoint).toBe(`${otherUrl}/index.php/login/v2/poll`);
    }),
  );

  test(
    "removing an account revokes it; switching the source off hides all accounts",
    inTenant(async () => {
      const { user, account } = await connected();
      expect((await sourceService.listSettings())[0]?.accounts).toBe(1);
      await sourceService.removeAccount(user.id, account.id);
      expect(revoked).toContain("anna");
      expect((await sourceService.listForUser(user.id))[0]?.accounts).toEqual([]);

      const again = await connected();
      await sourceService.saveSettings("nextcloud", { enabled: false, config: {} });
      expect(await sourceService.listForUser(again.user.id)).toEqual([]);
      await expect(sourceService.browse(again.user.id, again.account.id, null)).rejects.toThrow(
        "isn't switched on",
      );
      // Switched on again, the account is back.
      await sourceService.saveSettings("nextcloud", { enabled: true, config: { url } });
      expect((await sourceService.listForUser(again.user.id))[0]?.accounts).toHaveLength(1);
    }),
  );

  test("settings and accounts stay in their Sammelband", async () => {
    const a = await createTenant("A");
    const b = await createTenant("B");
    const { user, account } = await runInTenant(a.id, () => connected());
    await runInTenant(b.id, async () => {
      expect((await sourceService.listSettings())[0]).toMatchObject({
        enabled: false,
        accounts: 0,
      });
      await expect(sourceService.browse(user.id, account.id, null)).rejects.toThrow(
        "isn't connected",
      );
    });
    const rows = await db.selectFrom("source_accounts").select("tenant_id").execute();
    expect(rows.map((r) => r.tenant_id)).toEqual([a.id]);
  });
});
