import { auth } from "../auth";
import { db } from "../db/client";
import { AppError } from "../lib/errors";

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  createdAt: string;
};

const COLUMNS = ["id", "email", "name", "role", "createdAt"] as const;

// SQLite stores better-auth dates as ISO strings, Postgres returns Date objects.
function toPublic(u: Omit<PublicUser, "createdAt"> & { createdAt: string | Date }): PublicUser {
  return { ...u, createdAt: new Date(u.createdAt).toISOString() };
}

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await db.selectFrom("user").select(COLUMNS).orderBy("createdAt", "desc").execute();
  return rows.map(toPublic);
}

export async function getUser(id: string): Promise<PublicUser | null> {
  const row = await db.selectFrom("user").select(COLUMNS).where("id", "=", id).executeTakeFirst();
  return row ? toPublic(row) : null;
}

async function adminCount(): Promise<number> {
  const { n } = await db
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
  role: "admin" | "user";
}): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  if (await db.selectFrom("user").select("id").where("email", "=", email).executeTakeFirst()) {
    throw new AppError(409, "A user with that email already exists");
  }
  // Through better-auth so the password is hashed and account rows are created
  // exactly like a normal sign-up (the public sign-up endpoint is blocked).
  const res = await auth.api.signUpEmail({
    body: { email, password: input.password, name: input.name.trim() },
  });
  // role is input:false on sign-up, so set it afterwards.
  await db.updateTable("user").set({ role: input.role }).where("id", "=", res.user.id).execute();
  // signUpEmail opens a session for the new user; the admin doesn't need it.
  await signOutEverywhere(res.user.id);
  return requireUser(res.user.id);
}

export async function updateUser(
  actorId: string,
  id: string,
  patch: { name?: string; role?: "admin" | "user" },
): Promise<PublicUser> {
  const user = await requireUser(id);
  if (patch.role && patch.role !== user.role && user.role === "admin") {
    if (id === actorId) throw new AppError(400, "You cannot remove your own admin role");
    if ((await adminCount()) <= 1) throw new AppError(400, "Cannot demote the last admin");
  }
  await db
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
  if (user.role === "admin" && (await adminCount()) <= 1) {
    throw new AppError(400, "Cannot delete the last admin");
  }
  // session/account cascade; folders/albums/photos keep their content with
  // created_by / uploaded_by set to NULL.
  await db.deleteFrom("user").where("id", "=", id).execute();
}
