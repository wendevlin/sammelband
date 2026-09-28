import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { auth } from "../auth";
import { db } from "../db/client";
import { AppError } from "../lib/errors";
import { avatarPath } from "../lib/storage-paths";
import { tdb } from "../lib/tenant-context";

// The signed-in user's own account. Password checks go through better-auth
// with the request's session headers.

const AVATAR_SIZE = 256;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

async function checkPassword(headers: Headers, password: string): Promise<void> {
  try {
    await auth.api.verifyPassword({ body: { password }, headers });
  } catch {
    throw new AppError(401, "Current password is wrong");
  }
}

export async function updateProfile(
  userId: string,
  headers: Headers,
  input: { name?: string; email?: string; currentPassword?: string },
): Promise<void> {
  const user = await tdb()
    .selectFrom("user")
    .select(["name", "email"])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();
  const name = input.name?.trim() || user.name;
  const email = input.email?.trim().toLowerCase() || user.email;
  if (email !== user.email) {
    // Changing the sign-in email needs the password: a borrowed, still
    // signed-in browser must not be able to take the account over.
    if (!input.currentPassword) throw new AppError(400, "Enter your current password");
    await checkPassword(headers, input.currentPassword);
    const taken = await db
      .selectFrom("user")
      .select("id")
      .where("email", "=", email)
      .executeTakeFirst();
    if (taken) throw new AppError(409, "A user with that email already exists");
  }
  await tdb()
    .updateTable("user")
    .set({ name, email, updatedAt: new Date().toISOString() })
    .where("id", "=", userId)
    .execute();
}

/** Change the own password; other sessions are signed out. */
export async function changePassword(
  headers: Headers,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  try {
    await auth.api.changePassword({
      body: { ...input, revokeOtherSessions: true },
      headers,
    });
  } catch {
    throw new AppError(401, "Current password is wrong");
  }
}

/**
 * Set the avatar from an image the browser already cropped to a square. It
 * is re-encoded (which also drops EXIF data such as the location) at 256 px.
 */
export async function setAvatar(userId: string, file: File): Promise<string> {
  if (file.size > MAX_AVATAR_BYTES) throw new AppError(413, "Avatar images can be at most 5 MB");
  if (!file.type.startsWith("image/")) throw new AppError(400, "Only images are allowed");
  const buf = Buffer.from(await file.arrayBuffer());
  const { width, height } = await new Bun.Image(buf)
    .metadata()
    .catch(() => ({ width: 0, height: 0 }));
  if (!width || !height) throw new AppError(400, "Unable to read the image");
  if (width !== height) throw new AppError(400, "The avatar must be square");
  const output = await new Bun.Image(buf, { autoOrient: true })
    .resize(AVATAR_SIZE, AVATAR_SIZE)
    .webp({ quality: 85 })
    .bytes();
  const path = avatarPath(userId);
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, output);
  // The version query makes browsers fetch the new picture.
  const url = `/api/avatars/${userId}?v=${Date.now()}`;
  await tdb().updateTable("user").set({ image: url }).where("id", "=", userId).execute();
  return url;
}

export async function removeAvatar(userId: string): Promise<void> {
  rmSync(avatarPath(userId), { force: true });
  await tdb().updateTable("user").set({ image: null }).where("id", "=", userId).execute();
}

/** An avatar of a user in the current tenant. */
export async function serveAvatar(userId: string): Promise<Response> {
  const user = await tdb()
    .selectFrom("user")
    .select("id")
    .where("id", "=", userId)
    .executeTakeFirst();
  const file = Bun.file(avatarPath(userId));
  if (!user || !(await file.exists())) throw new AppError(404, "No avatar");
  return new Response(file, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
