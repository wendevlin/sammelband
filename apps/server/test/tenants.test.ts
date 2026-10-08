import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { sql } from "kysely";
import { auth } from "../src/auth";
import { db } from "../src/db/client";
import { TENANT_COLUMNS } from "../src/db/tenant-scope";
import { tenantDir } from "../src/lib/storage-paths";
import { runInTenant, tdb } from "../src/lib/tenant-context";
import * as albumService from "../src/services/album.service";
import * as exportService from "../src/services/export.service";
import * as folderService from "../src/services/folder.service";
import * as imageService from "../src/services/image.service";
import * as inviteService from "../src/services/invite.service";
import * as sectionService from "../src/services/section.service";
import * as shareService from "../src/services/share.service";
import * as sourceService from "../src/services/source.service";
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
    const section = await sectionService.createSection({ albumId: album.id });
    return { user, album, section };
  });
}

const signIn = (email: string) =>
  auth.api.signInEmail({ body: { email, password: "password123" } });

describe("quota", () => {
  test("new originals count against the quota, duplicates don't, deletes free space", async () => {
    const tenant = await createTenant();
    const { user, section } = await gallery(tenant.id);
    const red = png().size;
    const blue = png([0, 0, 255]).size;
    await db
      .updateTable("tenants")
      .set({ quota_bytes: red + blue })
      .execute();
    const used = async () => (await tenantService.currentTenant()).storage_used_bytes;

    await runInTenant(tenant.id, async () => {
      const first = await imageService.uploadPhoto(png(), section.id, user.id);
      await imageService.uploadPhoto(png(), section.id, user.id); // duplicate: free
      await imageService.uploadPhoto(png([0, 0, 255]), section.id, user.id);
      await expect(imageService.uploadPhoto(png([0, 255, 0]), section.id, user.id)).rejects.toThrow(
        "quota",
      );
      expect(await used()).toBe(red + blue);

      // The red file is still used by its duplicate after the first delete.
      await imageService.deletePhoto(first.photo.id);
      expect(await used()).toBe(red + blue);
      const others = await imageService.photosWithImage({ sectionId: section.id });
      const duplicate = others.find((p) => p.image_file_id === first.imageFile.id);
      await imageService.deletePhoto(duplicate?.id ?? "");
      expect(await used()).toBe(blue);
      await imageService.uploadPhoto(png([0, 255, 0]), section.id, user.id);
    });
  });
});

describe("tenant settings", () => {
  test("admins rename their own Sammelband; blank names are refused", async () => {
    const tenant = await createTenant("Old");
    await runInTenant(tenant.id, async () => {
      expect((await tenantService.updateCurrentTenant({ name: "  Family  " })).name).toBe("Family");
      await expect(tenantService.updateCurrentTenant({ name: " " })).rejects.toThrow("Name");
      // An empty patch (only another setting changed) returns the tenant as is.
      expect((await tenantService.updateCurrentTenant({})).name).toBe("Family");
      expect((await tenantService.currentTenant()).name).toBe("Family");
    });
  });
});

describe("storage counter", () => {
  test("reconciling corrects a drifted counter from the stored files", async () => {
    const tenant = await createTenant();
    const { user, section } = await gallery(tenant.id);
    await runInTenant(tenant.id, () => imageService.uploadPhoto(png(), section.id, user.id));
    const used = async () =>
      (await db.selectFrom("tenants").select("storage_used_bytes").executeTakeFirstOrThrow())
        .storage_used_bytes;
    const real = await used();
    await db.updateTable("tenants").set({ storage_used_bytes: 999_999 }).execute();
    await tenantService.reconcileStorage();
    expect(await used()).toBe(real);
    await db.updateTable("tenants").set({ storage_used_bytes: 5 }).execute();
    await tenantService.reconcileStorage(tenant.id);
    expect(await used()).toBe(png().size);
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

  test("the new admin can rename the Sammelband when accepting; users can't", async () => {
    const { tenant, invite } = await tenantService.createTenant({
      name: "Draft",
      quotaBytes: null,
    });
    await inviteService.acceptInvite(tokenOf(invite.url), {
      email: "admin@example.com",
      name: "Admin",
      password: "password123",
      sammelband: " Family Peleska ",
    });
    const name = async () =>
      (await db.selectFrom("tenants").select("name").where("id", "=", tenant.id).executeTakeFirst())
        ?.name;
    expect(await name()).toBe("Family Peleska");

    const userInvite = await runInTenant(tenant.id, () => inviteService.createTenantInvite("user"));
    await inviteService.acceptInvite(tokenOf(userInvite.url), {
      email: "user@example.com",
      name: "User",
      password: "password123",
      sammelband: "Hijacked",
    });
    expect(await name()).toBe("Family Peleska");
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
    const { user, section } = await gallery(tenant.id);
    await runInTenant(tenant.id, () => imageService.uploadPhoto(png(), section.id, user.id));
    expect(existsSync(tenantDir(tenant.id))).toBe(true);

    await expect(tenantService.deleteTenant(own.id, tenant.id, "Doom")).rejects.toThrow("name");
    await expect(tenantService.deleteTenant(own.id, own.id, "Own")).rejects.toThrow("own");
    // Capitalisation doesn't matter (form labels display names in capitals).
    await tenantService.deleteTenant(own.id, tenant.id, " DOOMED ");

    expect(existsSync(tenantDir(tenant.id))).toBe(false);
    for (const table of ["albums", "sections", "photos", "image_files", "folders"] as const) {
      expect(await db.selectFrom(table).select("id").execute()).toEqual([]);
    }
    expect(await db.selectFrom("user").select("id").where("id", "=", user.id).execute()).toEqual(
      [],
    );
  });

  test("deleting leaves no row behind in any tenant table", async () => {
    const own = await createTenant("Own");
    const tenant = await createTenant("Full");
    const user = await runInTenant(tenant.id, async () => {
      const { user, album, section } = await gallery(tenant.id);
      const folder = await folderService.createFolder({
        name: "F",
        parentId: null,
        createdBy: user.id,
      });
      await imageService.uploadPhoto(png(), section.id, user.id);
      await folderService.moveItem(null, user.id, { kind: "album", id: album.id, beforeId: null });
      await folderService.moveItem(null, user.id, {
        kind: "folder",
        id: folder.id,
        beforeId: null,
      });
      await shareService.createShare({ folderId: folder.id }, { password: "open sesame" }, user.id);
      await tenantService.updateCurrentTenant({ pdfExportEnabled: true });
      await exportService.createExport(album.id, user.id, {
        format: "a5",
        purpose: "screen",
        captions: false,
      });
      await exportService.exportsIdle();
      await inviteService.createTenantInvite("user");
      // A photo source and an account (without contacting a server).
      await tdb()
        .insertInto("source_settings")
        .values({
          tenant_id: tenant.id,
          source: "nextcloud",
          enabled: 1,
          config: "{}",
          updated_at: 1,
        })
        .execute();
      await sourceService.addAccount(user.id, "nextcloud", {
        label: "anna",
        config: {},
        credentials: { appPassword: "x" },
      });
      return user;
    });
    // better-auth's rows for the users (not tenant tables): a two-factor secret,
    // a trusted device and a password reset, written like better-auth does. The
    // same for a user of another tenant, whose rows have to stay.
    const keeper = await runInTenant(own.id, () => createUser());
    const ctx = await auth.$context;
    for (const u of [user, keeper]) {
      await ctx.adapter.create({
        model: "twoFactor",
        data: { secret: "secret", backupCodes: "codes", userId: u.id },
      });
      for (const identifier of [`trust-device-${u.id}`, `reset-password:${u.id}`]) {
        await ctx.internalAdapter.createVerificationValue({
          identifier,
          value: u.id,
          expiresAt: new Date(Date.now() + 60_000),
        });
      }
    }
    const authRowsOf = async (userId: string) => ({
      twoFactor: (
        await db.selectFrom("twoFactor").select("id").where("userId", "=", userId).execute()
      ).length,
      verification: (
        await db.selectFrom("verification").select("id").where("value", "=", userId).execute()
      ).length,
    });
    expect(await authRowsOf(user.id)).toEqual({ twoFactor: 1, verification: 2 });
    const rowsOf = async () => {
      const counts: Record<string, number> = {};
      for (const [table, column] of Object.entries(TENANT_COLUMNS)) {
        const { rows } = await sql<{ n: number }>`
          SELECT COUNT(*) AS n FROM ${sql.table(table)} WHERE ${sql.ref(column)} = ${tenant.id}`.execute(
          db,
        );
        counts[table] = Number(rows[0]?.n);
      }
      return counts;
    };
    // Every registered table has rows before, so the check below means something.
    expect(Object.values(await rowsOf()).every((n) => n > 0)).toBe(true);

    await tenantService.deleteTenant(own.id, tenant.id, "Full");
    expect(Object.values(await rowsOf()).every((n) => n === 0)).toBe(true);
    expect(await authRowsOf(user.id)).toEqual({ twoFactor: 0, verification: 0 });
    expect(await authRowsOf(keeper.id)).toEqual({ twoFactor: 1, verification: 2 });
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

  test("only the instance owner changes their own password and two-factor", async () => {
    const tenant = await createTenant();
    await runInTenant(tenant.id, async () => {
      const ownerId = await userService.createAccount({
        tenantId: tenant.id,
        email: "owner@example.com",
        name: "Owner",
        password: "password123",
        role: "admin",
        superadmin: true,
      });
      const admin = await createUser("admin");
      const user = await createUser();
      // As if both had turned it on (the reset only needs the flag).
      await db
        .updateTable("user")
        .set({ twoFactorEnabled: true })
        .where("id", "in", [ownerId, user.id])
        .execute();
      const signInWith = (email: string, password: string) =>
        auth.api.signInEmail({ body: { email, password } });

      // A co-admin can't take over the owner's account.
      await expect(
        userService.setPassword(admin.id, ownerId, "taken-over-123"),
      ).rejects.toMatchObject({ code: "owner_not_editable" });
      await expect(userService.resetTwoFactor(admin.id, ownerId)).rejects.toMatchObject({
        code: "owner_not_editable",
      });
      expect((await userService.getUser(ownerId))?.twoFactorEnabled).toBe(true);
      await expect(signInWith("owner@example.com", "taken-over-123")).rejects.toThrow();

      // The owner can set their own password on the admin page (and still needs a code).
      await userService.setPassword(ownerId, ownerId, "owners-new-123");
      expect(await signInWith("owner@example.com", "owners-new-123")).toMatchObject({
        twoFactorRedirect: true,
      });

      // Other users stay in the co-admin's hands.
      expect((await userService.resetTwoFactor(admin.id, user.id)).twoFactorEnabled).toBe(false);
      await userService.setPassword(admin.id, user.id, "users-new-123");
      expect(await signInWith(user.email, "users-new-123")).toMatchObject({
        user: { id: user.id },
      });
    });
  });
});
