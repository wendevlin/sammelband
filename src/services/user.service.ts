import { auth } from "../auth";
import { db } from "../db/client";
import { AppError } from "../lib/errors";
import { currentTenantId, tdb } from "../lib/tenant-context";

export type Role = "admin" | "user";

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  superadmin: boolean;
  createdAt: string;
};

const COLUMNS = ["id", "email", "name", "role", "superadmin", "createdAt"] as const;

// SQLite stores better-auth dates as ISO strings and booleans as 0/1.
function toPublic(u: {
  id: string;
  email: string;
  name: string;
  role: Role;
  superadmin: boolean | number | null;
  createdAt: string | Date;
}): PublicUser {
  return { ...u, superadmin: !!u.superadmin, createdAt: new Date(u.createdAt).toISOString() };
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
    throw new AppError(409, "A user with that email already exists");
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

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await tdb()
    .selectFrom("user")
    .select(COLUMNS)
    .orderBy("createdAt", "desc")
    .execute();
  return rows.map(toPublic);
}

export async function getUser(id: string): Promise<PublicUser | null> {
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

async function requireUser(id: string): Promise<PublicUser> {
  const u = await getUser(id);
  if (!u) throw new AppError(404, "User not found");
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
}): Promise<PublicUser> {
  const id = await createAccount({ ...input, tenantId: currentTenantId() });
  return requireUser(id);
}

export async function updateUser(
  actorId: string,
  id: string,
  patch: { name?: string; role?: Role },
): Promise<PublicUser> {
  const user = await requireUser(id);
  if (patch.role && patch.role !== user.role && user.role === "admin") {
    if (id === actorId) throw new AppError(400, "You cannot remove your own admin role");
    if (user.superadmin) throw new AppError(400, "The instance owner stays an admin");
    if ((await adminCount()) <= 1) throw new AppError(400, "Cannot demote the last admin");
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

export async function setPassword(id: string, password: string): Promise<void> {
  await requireUser(id);
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  await ctx.internalAdapter.updatePassword(id, hash);
  await signOutEverywhere(id);
}

export async function deleteUser(actorId: string, id: string): Promise<void> {
  const user = await requireUser(id);
  if (id === actorId) throw new AppError(400, "You cannot delete your own account");
  if (user.superadmin) throw new AppError(400, "The instance owner can't be deleted");
  if (user.role === "admin" && (await adminCount()) <= 1) {
    throw new AppError(400, "Cannot delete the last admin");
  }
  // session/account cascade; folders/albums/photos keep their content with
  // created_by / uploaded_by set to NULL.
  await tdb().deleteFrom("user").where("id", "=", id).execute();
}
