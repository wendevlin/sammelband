import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { auth } from "../src/auth";
import { db } from "../src/db/client";
import { tenantDir } from "../src/lib/storage-paths";
import { runInTenant } from "../src/lib/tenant-context";
import * as albumService from "../src/services/album.service";
import * as blockService from "../src/services/block.service";
import * as imageService from "../src/services/image.service";
import * as inviteService from "../src/services/invite.service";
import * as tenantService from "../src/services/tenant.service";
import * as userService from "../src/services/user.service";
import { createTenant, createUser, png } from "./helpers";

const tokenOf = (url: string) => url.split("/invite/")[1] ?? "";

async function gallery(tenantId: string) {
  return runInTenant(tenantId, async () => {
    const user = await createUser("admin");
    const album = await albumService.createAlbum({
      title: "A",
      folderId: null,
      createdBy: user.id,
    });
    const block = await blockService.createBlock({
      albumId: album.id,
      type: "gallery",
      content: {},
    });
    return { user, album, block };
  });
}

const signIn = (email: string) =>
  auth.api.signInEmail({ body: { email, password: "password123" } });

describe("quota", () => {
  test("new originals count against the quota, duplicates don't, deletes free space", async () => {
    const tenant = await createTenant();
    const { user, block } = await gallery(tenant.id);
    const red = png().size;
    const blue = png([0, 0, 255]).size;
    await db
      .updateTable("tenants")
      .set({ quota_bytes: red + blue })
      .execute();
    const used = async () => (await tenantService.currentTenant()).storage_used_bytes;

    await runInTenant(tenant.id, async () => {
      const first = await imageService.uploadPhoto(png(), block.id, user.id);
      await imageService.uploadPhoto(png(), block.id, user.id); // duplicate: free
      await imageService.uploadPhoto(png([0, 0, 255]), block.id, user.id);
      await expect(imageService.uploadPhoto(png([0, 255, 0]), block.id, user.id)).rejects.toThrow(
        "quota",
      );
      expect(await used()).toBe(red + blue);

      // The red file is still used by its duplicate after the first delete.
      await imageService.deletePhoto(first.photo.id);
      expect(await used()).toBe(red + blue);
      const others = await imageService.photosWithImage({ blockId: block.id });
      const duplicate = others.find((p) => p.image_file_id === first.imageFile.id);
      await imageService.deletePhoto(duplicate?.id ?? "");
      expect(await used()).toBe(blue);
      await imageService.uploadPhoto(png([0, 255, 0]), block.id, user.id);
    });
  });
});

describe("invites", () => {
  test("a new Sammelband's admin signs up through the invite link, once", async () => {
    const { tenant, invite } = await tenantService.createTenant({
      name: "Family",
      quotaBytes: null,
    });
    const token = tokenOf(invite.url);
    expect(await inviteService.describeInvite(token)).toEqual({
      sammelband: "Family",
      role: "admin",
    });

    await inviteService.acceptInvite(token, {
      email: "mum@example.com",
      name: "Mum",
      password: "password123",
    });
    const session = await signIn("mum@example.com");
    const user = session.user as { tenantId?: string; role?: string };
    expect(user.tenantId).toBe(tenant.id);
    expect(user.role).toBe("admin");

    await expect(inviteService.describeInvite(token)).rejects.toThrow("invalid");
    await expect(
      inviteService.acceptInvite(token, {
        email: "someone@example.com",
        name: "X",
        password: "password123",
      }),
    ).rejects.toThrow("invalid");
  });

  test("a failed sign-up leaves the invite usable; renewing replaces old links", async () => {
    const other = await createTenant();
    const taken = await runInTenant(other.id, () => createUser());
    const { tenant, invite } = await tenantService.createTenant({ name: "F", quotaBytes: null });
    const token = tokenOf(invite.url);
    await expect(
      inviteService.acceptInvite(token, { email: taken.email, name: "X", password: "password123" }),
    ).rejects.toThrow("already exists");
    expect(await inviteService.describeInvite(token)).toMatchObject({ role: "admin" });

    const renewed = await tenantService.renewAdminInvite(tenant.id);
    await expect(inviteService.describeInvite(token)).rejects.toThrow("invalid");
    expect(await inviteService.describeInvite(tokenOf(renewed.url))).toMatchObject({
      sammelband: "F",
    });
  });

  test("expired links and tenant-admin user invites", async () => {
    const tenant = await createTenant("Home");
    const invite = await runInTenant(tenant.id, () => inviteService.createTenantInvite("user"));
    const token = tokenOf(invite.url);
    expect(await inviteService.describeInvite(token)).toEqual({ sammelband: "Home", role: "user" });

    await db
      .updateTable("tenant_invites")
      .set({ expires_at: Date.now() - 1 })
      .execute();
    await expect(inviteService.describeInvite(token)).rejects.toThrow("expired");
  });
});

describe("superadmin", () => {
  test("suspending signs everyone out and blocks sign-in", async () => {
    const own = await createTenant("Own");
    const tenant = await createTenant("Other");
    const user = await runInTenant(tenant.id, () => createUser());
    await signIn(user.email);

    await tenantService.updateTenant(own.id, tenant.id, { suspended: true });
    const sessions = await db
      .selectFrom("session")
      .select("id")
      .where("userId", "=", user.id)
      .execute();
    expect(sessions).toEqual([]);
    await expect(signIn(user.email)).rejects.toThrow("suspended");

    await tenantService.updateTenant(own.id, tenant.id, { suspended: false });
    expect((await signIn(user.email)).user.id).toBe(user.id);

    await expect(tenantService.updateTenant(own.id, own.id, { suspended: true })).rejects.toThrow(
      "own",
    );
  });

  test("deleting removes users, content and files; needs the name", async () => {
    const own = await createTenant("Own");
    const tenant = await createTenant("Doomed");
    const { user, block } = await gallery(tenant.id);
    await runInTenant(tenant.id, () => imageService.uploadPhoto(png(), block.id, user.id));
    expect(existsSync(tenantDir(tenant.id))).toBe(true);

    await expect(tenantService.deleteTenant(own.id, tenant.id, "doomed")).rejects.toThrow("name");
    await expect(tenantService.deleteTenant(own.id, own.id, "Own")).rejects.toThrow("own");
    await tenantService.deleteTenant(own.id, tenant.id, "Doomed");

    expect(existsSync(tenantDir(tenant.id))).toBe(false);
    for (const table of ["albums", "album_blocks", "photos", "image_files", "folders"] as const) {
      expect(await db.selectFrom(table).select("id").execute()).toEqual([]);
    }
    expect(await db.selectFrom("user").select("id").where("id", "=", user.id).execute()).toEqual(
      [],
    );
  });

  test("overview counts per tenant", async () => {
    const own = await createTenant("Own");
    const { tenant } = await tenantService.createTenant({ name: "New", quotaBytes: 1000 });
    await gallery(own.id);
    const list = await tenantService.listTenants(own.id);
    expect(list.map((t) => [t.name, t.own, t.user_count, t.album_count, t.invite_pending])).toEqual(
      [
        ["Own", true, 1, 1, false],
        ["New", false, 0, 0, true],
      ],
    );
    expect(list[1]?.id).toBe(tenant.id);
    expect(list[1]?.quota_bytes).toBe(1000);
  });

  test("the instance owner can't be demoted or deleted", async () => {
    const tenant = await createTenant();
    await runInTenant(tenant.id, async () => {
      const owner = await userService.getUser(
        await userService.createAccount({
          tenantId: tenant.id,
          email: "owner@example.com",
          name: "Owner",
          password: "password123",
          role: "admin",
          superadmin: true,
        }),
      );
      const admin = await createUser("admin");
      expect(owner?.superadmin).toBe(true);
      await expect(
        userService.updateUser(admin.id, owner?.id ?? "", { role: "user" }),
      ).rejects.toThrow("owner");
      await expect(userService.deleteUser(admin.id, owner?.id ?? "")).rejects.toThrow("owner");
    });
  });
});
