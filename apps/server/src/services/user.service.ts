import type { Role, User } from "@sammelband/shared";
import { auth } from "../auth";
import { db } from "../db/client";
import { fail } from "../lib/errors";
import { currentTenantId, tdb } from "../lib/tenant-context";
import * as profileService from "./profile.service";

export type { Role };

const COLUMNS = [
  "id",
  "email",
  "name",
  "role",
  "superadmin",
  "image",
  "twoFactorEnabled",
  "createdAt",
] as const;

// SQLite stores better-auth dates as ISO strings and booleans as 0/1.
function toPublic(u: {
  id: string;
  email: string;
  name: string;
  role: Role;
  superadmin: boolean | number | null;
  image: string | null;
  twoFactorEnabled: boolean | number | null;
  createdAt: string | Date;
}): User {
  return {
    ...u,
    superadmin: !!u.superadmin,
    twoFactorEnabled: !!u.twoFactorEnabled,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}

/**
 * Create an account in a tenant. Used by admins, invite links and the first-run
 * setup; not tenant-scoped itself, the callers decide the tenant.
 */
export async function createAccount(input: {
  tenantId: string;
  email: string;
  name: string;
  password: string;
  role: Role;
  superadmin?: boolean;
}): Promise<string> {
  const email = input.email.trim().toLowerCase();
  // Emails are unique across the instance: a person belongs to one tenant.
  if (await db.selectFrom("user").select("id").where("email", "=", email).executeTakeFirst()) {
    throw fail("email_taken");
  }
  // Through better-auth so the password is hashed and account rows are created
  // exactly like a normal sign-up (the public sign-up endpoint is blocked).
  const res = await auth.api.signUpEmail({
    body: { email, password: input.password, name: input.name.trim() || email },
  });
  // tenantId, role and superadmin are input:false on sign-up, so set them afterwards.
  // Until then the user has no tenant, which counts as signed out.
  await db
    .updateTable("user")
    .set({ tenantId: input.tenantId, role: input.role, superadmin: input.superadmin ?? false })
    .where("id", "=", res.user.id)
    .execute();
  // signUpEmail opens a session nobody holds; the user signs in themselves.
  await db.deleteFrom("session").where("userId", "=", res.user.id).execute();
  return res.user.id;
}

// Everything below is confined to the current tenant.

export async function listUsers(): Promise<User[]> {
  const rows = await tdb()
    .selectFrom("user")
    .select(COLUMNS)
    .orderBy("createdAt", "desc")
    .execute();
  return rows.map(toPublic);
}

export async function getUser(id: string): Promise<User | null> {
  const row = await tdb()
    .selectFrom("user")
    .select(COLUMNS)
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? toPublic(row) : null;
}

async function adminCount(): Promise<number> {
  const { n } = await tdb()
    .selectFrom("user")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("role", "=", "admin")
    .executeTakeFirstOrThrow();
  return Number(n);
}

async function requireUser(id: string): Promise<User> {
  const u = await getUser(id);
  if (!u) throw fail("user_not_found");
  return u;
}

function signOutEverywhere(userId: string) {
  return db.deleteFrom("session").where("userId", "=", userId).execute();
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: Role;
}): Promise<User> {
  const id = await createAccount({ ...input, tenantId: currentTenantId() });
  return requireUser(id);
}

export async function updateUser(
  actorId: string,
  id: string,
  patch: { name?: string; role?: Role },
): Promise<User> {
  const user = await requireUser(id);
  if (patch.role && patch.role !== user.role && user.role === "admin") {
    if (id === actorId) throw fail("cannot_demote_self");
    if (user.superadmin) throw fail("owner_stays_admin");
    if ((await adminCount()) <= 1) throw fail("last_admin_demote");
  }
  await tdb()
    .updateTable("user")
    .set({
      name: patch.name?.trim() || user.name,
      role: patch.role ?? user.role,
      updatedAt: new Date().toISOString(),
    })
    .where("id", "=", id)
    .execute();
  return requireUser(id);
}

/** An admin sets someone's avatar: same rules as one's own (square, re-encoded). */
export async function setAvatar(id: string, file: File): Promise<User> {
  await requireUser(id);
  await profileService.setAvatar(id, file);
  return requireUser(id);
}

export async function removeAvatar(id: string): Promise<User> {
  await requireUser(id);
  await profileService.removeAvatar(id);
  return requireUser(id);
}

export async function setPassword(actorId: string, id: string, password: string): Promise<void> {
  const user = await requireUser(id);
  // The owner is an ordinary member of the first tenant; a co-admin taking over
  // their account would take over the whole instance.
  if (user.superadmin && id !== actorId) throw fail("owner_not_editable");
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  await ctx.internalAdapter.updatePassword(id, hash);
  await signOutEverywhere(id);
}

/**
 * Admin: turn off a user's two-factor authentication, e.g. after they lost
 * their phone. They sign in with their password again (and set it up anew
 * where it's required); trusted devices are forgotten.
 */
export async function resetTwoFactor(actorId: string, id: string): Promise<User> {
  const user = await requireUser(id);
  if (id === actorId) throw fail("two_factor_reset_own");
  if (user.superadmin) throw fail("owner_not_editable");
  await tdb()
    .updateTable("user")
    .set({ twoFactorEnabled: false, updatedAt: new Date().toISOString() })
    .where("id", "=", id)
    .execute();
  // Not tenant tables; the user was checked above.
  await db.deleteFrom("twoFactor").where("userId", "=", id).execute();
  await db
    .deleteFrom("verification")
    .where("value", "=", id)
    .where("identifier", "like", "trust-device-%")
    .execute();
  return requireUser(id);
}

export async function deleteUser(actorId: string, id: string): Promise<void> {
  const user = await requireUser(id);
  if (id === actorId) throw fail("cannot_delete_self");
  if (user.superadmin) throw fail("owner_not_deletable");
  if (user.role === "admin" && (await adminCount()) <= 1) {
    throw fail("last_admin_delete");
  }
  // session/account cascade; folders/albums/photos keep their content with
  // created_by / uploaded_by set to NULL.
  await tdb().deleteFrom("user").where("id", "=", id).execute();
}
