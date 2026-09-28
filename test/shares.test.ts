import { describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { runInTenant } from "../src/lib/tenant-context";
import * as albumService from "../src/services/album.service";
import * as blockService from "../src/services/block.service";
import * as folderService from "../src/services/folder.service";
import * as imageService from "../src/services/image.service";
import * as publicService from "../src/services/public.service";
import * as shareService from "../src/services/share.service";
import * as tenantService from "../src/services/tenant.service";
import { createTenant, createUser, png } from "./helpers";

const tokenOf = (url: string) => url.split("/s/")[1] ?? "";

/**
 * Tenant with: Family/ (album "Inside" with a photo) → Kids/ (album "Deeper"),
 * a root album "Outside" with a photo, and an album-less folder "Other".
 */
async function setup() {
  const tenant = await createTenant();
  const data = await runInTenant(tenant.id, async () => {
    const user = await createUser();
    const family = await folderService.createFolder({
      name: "Family",
      parentId: null,
      createdBy: user.id,
    });
    const kids = await folderService.createFolder({
      name: "Kids",
      parentId: family.id,
      createdBy: user.id,
    });
    const other = await folderService.createFolder({
      name: "Other",
      parentId: null,
      createdBy: user.id,
    });
    const withPhoto = async (
      title: string,
      folderId: string | null,
      rgb: [number, number, number],
    ) => {
      const album = await albumService.createAlbum({ title, folderId, createdBy: user.id });
      const block = await blockService.createBlock({
        albumId: album.id,
        type: "gallery",
        content: {},
      });
      const { imageFile } = await imageService.uploadPhoto(png(rgb), block.id, user.id);
      return { album, filename: imageFile.filename };
    };
    const inside = await withPhoto("Inside", family.id, [255, 0, 0]);
    const deeper = await withPhoto("Deeper", kids.id, [0, 255, 0]);
    const outside = await withPhoto("Outside", null, [0, 0, 255]);
    return { user, family, kids, other, inside, deeper, outside };
  });
  const as = <T>(fn: () => Promise<T>) => runInTenant(tenant.id, fn);
  return { tenant, as, ...data };
}

const open = async (token: string, cookie?: string) => publicService.access(token, () => cookie);

describe("share links", () => {
  test("an album link shows that album and only its images", async () => {
    const { as, user, inside, outside } = await setup();
    const link = await as(() =>
      shareService.createShare({ albumId: inside.album.id }, {}, user.id),
    );
    const token = tokenOf(link.url);

    const view = await publicService.view(await open(token), {});
    expect(view.status === "ok" && view.kind === "album" && view.album.title).toBe("Inside");
    if (view.status === "ok" && view.kind === "album") {
      expect(view.photos.map((p) => p.filename)).toEqual([inside.filename]);
      expect(Object.keys(view.album).sort()).toEqual(["description", "id", "short_id", "title"]);
      expect(JSON.stringify(view)).not.toContain(user.id);
    }

    const ok = await publicService.image(await open(token), inside.filename, 400, "webp");
    expect(ok.status).toBe(200);
    await expect(
      publicService.image(await open(token), outside.filename, 400, "webp"),
    ).rejects.toThrow("not found");
    await expect(
      publicService.view(await open(token), { albumRef: outside.album.short_id }),
    ).rejects.toThrow("Not part");
  });

  test("a folder link covers its subtree and nothing else", async () => {
    const { as, user, family, kids, other, inside, deeper, outside } = await setup();
    const link = await as(() => shareService.createShare({ folderId: family.id }, {}, user.id));
    const token = tokenOf(link.url);
    const access = await open(token);

    const root = await publicService.view(access, {});
    expect(root.status === "ok" && root.kind === "folder").toBe(true);
    if (root.status === "ok" && root.kind === "folder") {
      expect(root.folders.map((f) => [f.name, f.covers])).toEqual([["Kids", [deeper.filename]]]);
      expect(root.albums.map((a) => a.title)).toEqual(["Inside"]);
      expect(root.trail.map((t) => t.name)).toEqual(["Family"]);
    }
    const sub = await publicService.view(access, { folderId: kids.id });
    expect(sub.status === "ok" && sub.kind === "folder" && sub.trail.map((t) => t.name)).toEqual([
      "Family",
      "Kids",
    ]);
    const album = await publicService.view(access, { albumRef: `deeper-${deeper.album.short_id}` });
    expect(
      album.status === "ok" && album.kind === "album" && album.trail.map((t) => t.name),
    ).toEqual(["Family", "Kids"]);

    for (const at of [{ folderId: other.id }, { albumRef: outside.album.short_id }]) {
      await expect(publicService.view(access, at)).rejects.toThrow("Not part");
    }
    expect((await publicService.image(access, inside.filename, 800, "jpeg")).status).toBe(200);
    expect((await publicService.image(access, deeper.filename, 400, "webp")).status).toBe(200);
    await expect(publicService.image(access, outside.filename, 400, "webp")).rejects.toThrow(
      "not found",
    );
  });

  test("password links need the unlock cookie; a wrong password is refused", async () => {
    const { as, user, inside } = await setup();
    const link = await as(() =>
      shareService.createShare({ albumId: inside.album.id }, { password: "secret" }, user.id),
    );
    expect(link.has_password).toBe(true);
    const token = tokenOf(link.url);

    expect(await publicService.view(await open(token), {})).toEqual({ status: "locked" });
    const locked = await open(token);
    expect(() => publicService.image(locked, inside.filename, 400, "webp")).toThrow("password");
    await expect(publicService.unlock(token, "nope")).rejects.toThrow("Wrong password");

    const cookie = await publicService.unlock(token, "secret");
    const view = await publicService.view(await open(token, cookie.value), {});
    expect(view.status).toBe("ok");
    expect((await publicService.view(await open(token, `${cookie.value}x`), {})).status).toBe(
      "locked",
    );
    const [expires, sig] = cookie.value.split(".");
    expect(
      (await publicService.view(await open(token, `${Number(expires) + 1}.${sig}`), {})).status,
    ).toBe("locked");
  });

  test("expired, revoked and suspended links stop working; others keep working", async () => {
    const { tenant, as, user, inside } = await setup();
    const a = await as(() => shareService.createShare({ albumId: inside.album.id }, {}, user.id));
    const b = await as(() => shareService.createShare({ albumId: inside.album.id }, {}, user.id));
    await as(() => shareService.deleteShare(a.id));
    await expect(open(tokenOf(a.url))).rejects.toThrow("invalid");
    expect((await publicService.view(await open(tokenOf(b.url)), {})).status).toBe("ok");

    await db
      .updateTable("share_links")
      .set({ expires_at: Date.now() - 1 })
      .execute();
    await expect(open(tokenOf(b.url))).rejects.toThrow("expired");
    await db.updateTable("share_links").set({ expires_at: null }).execute();

    const own = await createTenant("Owner");
    await tenantService.updateTenant(own.id, tenant.id, { suspended: true });
    await expect(open(tokenOf(b.url))).rejects.toThrow("invalid");
  });

  test("links are listed per item and managed within the tenant only", async () => {
    const { as, user, inside, family } = await setup();
    await as(() =>
      shareService.createShare({ albumId: inside.album.id }, { expiresOn: "2099-12-31" }, user.id),
    );
    await as(() => shareService.createShare({ folderId: family.id }, {}, user.id));
    const albumLinks = await as(() => shareService.listShares({ albumId: inside.album.id }));
    expect(albumLinks).toHaveLength(1);
    expect(albumLinks[0]?.created_by_name).toBe(user.name);

    await expect(
      as(() =>
        shareService.createShare(
          { albumId: inside.album.id },
          { expiresOn: "2000-01-01" },
          user.id,
        ),
      ),
    ).rejects.toThrow("future");
    await expect(
      as(() =>
        shareService.createShare({ albumId: inside.album.id }, { password: "abc" }, user.id),
      ),
    ).rejects.toThrow("at least");

    const other = await createTenant("Other");
    await runInTenant(other.id, async () => {
      const intruder = await createUser();
      await expect(shareService.listShares({ albumId: inside.album.id })).rejects.toThrow(
        "not found",
      );
      await expect(
        shareService.createShare({ folderId: family.id }, {}, intruder.id),
      ).rejects.toThrow("not found");
      await expect(shareService.deleteShare(albumLinks[0]?.id ?? "")).rejects.toThrow("not found");
    });
  });

  test("link previews show the cover, but nothing behind a password", async () => {
    const { as, user, family, inside } = await setup();
    const albumLink = await as(() =>
      shareService.createShare({ albumId: inside.album.id }, {}, user.id),
    );
    const preview = await publicService.linkPreview(tokenOf(albumLink.url), {});
    expect(preview?.title).toBe("Inside");
    expect(preview?.description).toBe("1 photo");
    expect(preview?.image?.url).toMatch(
      new RegExp(
        `/api/public/${tokenOf(albumLink.url)}/images/${inside.filename}\\?w=1200&format=jpeg$`,
      ),
    );
    // The test PNG is 40 × 30; the variant is scaled to 1200 wide.
    expect([preview?.image?.width, preview?.image?.height]).toEqual([1200, 900]);

    const folderLink = await as(() =>
      shareService.createShare({ folderId: family.id }, {}, user.id),
    );
    const folderPreview = await publicService.linkPreview(tokenOf(folderLink.url), {});
    expect(folderPreview?.title).toBe("Family");
    expect(folderPreview?.description).toBe("1 album · 1 folder");
    expect(folderPreview?.image?.url).toContain(inside.filename);

    const locked = await as(() =>
      shareService.createShare({ albumId: inside.album.id }, { password: "secret" }, user.id),
    );
    const lockedPreview = await publicService.linkPreview(tokenOf(locked.url), {});
    expect(lockedPreview).toEqual({
      title: "Password-protected link",
      description: "Shared on Sammelband",
      image: null,
    });
    expect(JSON.stringify(lockedPreview)).not.toContain("Inside");

    expect(await publicService.linkPreview("nope", {})).toBeNull();
  });

  test("expiry dates end at 23:59:59 in the Sammelband's time zone", async () => {
    const { as, user, inside } = await setup();
    await as(async () => {
      await expect(tenantService.setTimezone("Mars/Olympus")).rejects.toThrow("Unknown");
      expect((await tenantService.setTimezone("Asia/Kolkata")).timezone).toBe("Asia/Kolkata");
      const link = await shareService.createShare(
        { albumId: inside.album.id },
        { expiresOn: "2099-06-15" },
        user.id,
      );
      expect(new Date(link.expires_at ?? 0).toISOString()).toBe("2099-06-15T18:29:59.999Z");
    });
  });

  test("deleting the album removes its links", async () => {
    const { as, user, inside } = await setup();
    const link = await as(() =>
      shareService.createShare({ albumId: inside.album.id }, {}, user.id),
    );
    await as(() => albumService.deleteAlbum(inside.album.id));
    await expect(open(tokenOf(link.url))).rejects.toThrow("invalid");
  });
});
