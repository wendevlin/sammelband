import { describe, expect, test } from "bun:test";
import * as albumService from "../src/services/album.service";
import * as userService from "../src/services/user.service";
import { createUser, inTenant } from "./helpers";

describe("users", () => {
  test(
    "create sets the role and rejects duplicate emails",
    inTenant(async () => {
      const admin = await createUser("admin");
      expect(admin.role).toBe("admin");
      expect(Number.isNaN(Date.parse(admin.createdAt))).toBe(false);
      await expect(
        userService.createUser({
          email: admin.email.toUpperCase(),
          name: "Dup",
          password: "password123",
          role: "user",
        }),
      ).rejects.toThrow("already exists");
      expect((await userService.listUsers()).map((u) => u.id)).toEqual([admin.id]);
    }),
  );

  test(
    "the last admin can't be demoted or deleted",
    inTenant(async () => {
      const admin = await createUser("admin");
      const other = await createUser("admin");
      await expect(userService.updateUser(admin.id, admin.id, { role: "user" })).rejects.toThrow(
        "own",
      );
      await expect(userService.deleteUser(admin.id, admin.id)).rejects.toThrow("own account");

      await userService.updateUser(admin.id, other.id, { role: "user", name: "Renamed" });
      expect(await userService.getUser(other.id)).toMatchObject({ role: "user", name: "Renamed" });
      await expect(userService.deleteUser(other.id, admin.id)).rejects.toThrow("last admin");
    }),
  );

  test(
    "deleting a user keeps their content",
    inTenant(async () => {
      const admin = await createUser("admin");
      const user = await createUser();
      const album = await albumService.createAlbum({
        title: "Kept",
        folderId: null,
        createdBy: user.id,
      });
      await userService.deleteUser(admin.id, user.id);
      expect(await userService.getUser(user.id)).toBeNull();
      expect((await albumService.getAlbum(album.id))?.created_by).toBeNull();
    }),
  );

  test(
    "setting a password works for sign-in",
    inTenant(async () => {
      const { auth } = await import("../src/auth");
      const admin = await createUser("admin");
      const user = await createUser();
      await userService.setPassword(admin.id, user.id, "new-password-123");
      const res = await auth.api.signInEmail({
        body: { email: user.email, password: "new-password-123" },
      });
      expect(res.user.id).toBe(user.id);
    }),
  );
});
