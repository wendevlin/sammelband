import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { auth } from "../src/auth";
import { avatarPath } from "../src/lib/storage-paths";
import { runInTenant } from "../src/lib/tenant-context";
import * as profileService from "../src/services/profile.service";
import * as userService from "../src/services/user.service";
import { createTenant, createUser, inTenant, png } from "./helpers";

/** Request headers carrying a fresh session of `email` (password "password123"). */
async function sessionHeaders(email: string, password = "password123"): Promise<Headers> {
  const res = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

describe("profile", () => {
  test(
    "name changes freely; email only with the current password",
    inTenant(async () => {
      const user = await createUser();
      const headers = await sessionHeaders(user.email);
      await profileService.updateProfile(user.id, headers, { name: "New Name" });
      expect((await userService.getUser(user.id))?.name).toBe("New Name");

      await expect(
        profileService.updateProfile(user.id, headers, { email: "new@example.com" }),
      ).rejects.toThrow("current password");
      await expect(
        profileService.updateProfile(user.id, headers, {
          email: "new@example.com",
          currentPassword: "wrong-password",
        }),
      ).rejects.toThrow("wrong");
      await profileService.updateProfile(user.id, headers, {
        email: "New@Example.com",
        currentPassword: "password123",
      });
      expect((await userService.getUser(user.id))?.email).toBe("new@example.com");

      const other = await createUser();
      await expect(
        profileService.updateProfile(user.id, headers, {
          email: other.email,
          currentPassword: "password123",
        }),
      ).rejects.toThrow("already exists");
    }),
  );

  test(
    "the UI language is saved with the account",
    inTenant(async () => {
      const user = await createUser();
      const headers = await sessionHeaders(user.email);
      await profileService.updateProfile(user.id, headers, { locale: "de" });
      const session = await auth.api.getSession({ headers });
      expect((session?.user as { locale?: string } | undefined)?.locale).toBe("de");
      await profileService.updateProfile(user.id, headers, { locale: null });
      const cleared = await auth.api.getSession({ headers });
      expect((cleared?.user as { locale?: string | null } | undefined)?.locale ?? null).toBeNull();
    }),
  );

  test(
    "changing the password needs the current one",
    inTenant(async () => {
      const user = await createUser();
      const headers = await sessionHeaders(user.email);
      await expect(
        profileService.changePassword(headers, {
          currentPassword: "wrong-password",
          newPassword: "brand-new-password",
        }),
      ).rejects.toThrow("wrong");
      await profileService.changePassword(headers, {
        currentPassword: "password123",
        newPassword: "brand-new-password",
      });
      await sessionHeaders(user.email, "brand-new-password");
    }),
  );

  test("avatars: square only, re-encoded, visible within the tenant only", async () => {
    const tenant = await createTenant();
    const user = await runInTenant(tenant.id, () => createUser());
    await runInTenant(tenant.id, async () => {
      await expect(profileService.setAvatar(user.id, png())).rejects.toThrow("square");
      const url = await profileService.setAvatar(user.id, png([0, 0, 255], "me.png", 64, 64));
      expect(url).toMatch(new RegExp(`^/api/avatars/${user.id}\\?v=\\d+$`));
      expect((await userService.getUser(user.id))?.image).toBe(url);
      const res = await profileService.serveAvatar(user.id);
      expect(res.headers.get("content-type")).toBe("image/webp");
      const { width, height } = await new Bun.Image(
        Buffer.from(await res.arrayBuffer()),
      ).metadata();
      expect([width, height]).toEqual([256, 256]);
    });

    const other = await createTenant("Other");
    await runInTenant(other.id, async () => {
      await expect(profileService.serveAvatar(user.id)).rejects.toThrow("No avatar");
    });

    await runInTenant(tenant.id, async () => {
      const path = avatarPath(user.id);
      await profileService.removeAvatar(user.id);
      expect(existsSync(path)).toBe(false);
      expect((await userService.getUser(user.id))?.image).toBeNull();
    });
  });
});
