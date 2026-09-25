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

const COLUMNS = "id, email, name, role, createdAt";

export function listUsers(): PublicUser[] {
  return db.query(`SELECT ${COLUMNS} FROM user ORDER BY createdAt DESC`).all() as PublicUser[];
}

export function getUser(id: string): PublicUser | null {
  return db.query(`SELECT ${COLUMNS} FROM user WHERE id = ?`).get(id) as PublicUser | null;
}

function adminCount(): number {
  return (db.query("SELECT COUNT(*) AS n FROM user WHERE role = 'admin'").get() as { n: number }).n;
}

function requireUser(id: string): PublicUser {
  const u = getUser(id);
  if (!u) throw new AppError(404, "User not found");
  return u;
}

export async function createUser(input: {
  email: string;
  name: string;
  password: string;
  role: "admin" | "user";
}): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  if (db.query("SELECT 1 FROM user WHERE email = ?").get(email)) {
    throw new AppError(409, "A user with that email already exists");
  }
  // Through better-auth so the password is hashed and account rows are created
  // exactly like a normal sign-up (the public sign-up endpoint is blocked).
  const res = await auth.api.signUpEmail({
    body: { email, password: input.password, name: input.name.trim() },
  });
  // role is input:false on sign-up, so set it afterwards.
  db.run("UPDATE user SET role = ? WHERE id = ?", [input.role, res.user.id]);
  // signUpEmail opens a session for the new user; the admin doesn't need it.
  db.run("DELETE FROM session WHERE userId = ?", [res.user.id]);
  return requireUser(res.user.id);
}

export function updateUser(
  actorId: string,
  id: string,
  patch: { name?: string; role?: "admin" | "user" },
): PublicUser {
  const user = requireUser(id);
  if (patch.role && patch.role !== user.role && user.role === "admin") {
    if (id === actorId) throw new AppError(400, "You cannot remove your own admin role");
    if (adminCount() <= 1) throw new AppError(400, "Cannot demote the last admin");
  }
  db.run("UPDATE user SET name = ?, role = ?, updatedAt = ? WHERE id = ?", [
    patch.name?.trim() || user.name,
    patch.role ?? user.role,
    Date.now(),
    id,
  ]);
  return requireUser(id);
}

export async function setPassword(id: string, password: string): Promise<void> {
  requireUser(id);
  const ctx = await auth.$context;
  const hash = await ctx.password.hash(password);
  await ctx.internalAdapter.updatePassword(id, hash);
  // Sign the user out everywhere.
  db.run("DELETE FROM session WHERE userId = ?", [id]);
}

export function deleteUser(actorId: string, id: string): void {
  const user = requireUser(id);
  if (id === actorId) throw new AppError(400, "You cannot delete your own account");
  if (user.role === "admin" && adminCount() <= 1) {
    throw new AppError(400, "Cannot delete the last admin");
  }
  // session/account cascade; folders/albums/photos keep their content with
  // created_by / uploaded_by set to NULL.
  db.run("DELETE FROM user WHERE id = ?", [id]);
}
