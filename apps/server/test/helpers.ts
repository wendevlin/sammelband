import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { sql } from "kysely";
import { config } from "../src/config";
import { db } from "../src/db/client";
import type { ImageFile } from "../src/db/schema";
import { originalsDir } from "../src/lib/storage-paths";
import { currentTenantId, runInTenant } from "../src/lib/tenant-context";
import { createFirstTenant } from "../src/services/tenant.service";
import * as userService from "../src/services/user.service";

// Children before parents, so foreign keys never block a delete.
const TABLES = [
  "share_links",
  "album_positions",
  "folder_positions",
  "folder_sort",
  "tenant_invites",
  "photos",
  "image_files",
  "sections",
  "albums",
  "folders",
  "session",
  "account",
  "verification",
  "twoFactor",
  "user",
  "tenants",
  "instance_settings",
];

export async function resetDatabase(): Promise<void> {
  // folders.parent_id is ON DELETE RESTRICT, which SQLite checks row by row.
  await db.updateTable("folders").set({ parent_id: null }).execute();
  for (const table of TABLES) await sql`DELETE FROM ${sql.table(table)}`.execute(db);
  rmSync(config.UPLOADS_PATH, { recursive: true, force: true });
  mkdirSync(config.UPLOADS_PATH, { recursive: true });
}

export function createTenant(name = "Test") {
  return createFirstTenant(name);
}

/** Wrap a test body: runs it inside a fresh tenant, like a signed-in request. */
export function inTenant(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const tenant = await createTenant();
    await runInTenant(tenant.id, fn);
  };
}

export function originalFile(file: ImageFile): string {
  return join(originalsDir(currentTenantId()), file.filename);
}

let counter = 0;

/** A user in the current tenant. */
export function createUser(role: "admin" | "user" = "user") {
  counter++;
  return userService.createUser({
    email: `user${counter}@example.com`,
    name: `User ${counter}`,
    password: "password123",
    role,
  });
}

/** A solid-color PNG (40×30 by default); different colors give different content hashes. */
export function png(
  rgb: [number, number, number] = [255, 0, 0],
  name = "photo.png",
  width = 40,
  height = 30,
): File {
  const row = [0, ...Array.from({ length: width }, () => rgb).flat()]; // filter byte + pixels
  const pixels = new Uint8Array(Array.from({ length: height }, () => row).flat());
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array([...new TextEncoder().encode(type), ...data]);
    const out = new DataView(new ArrayBuffer(body.length + 8));
    out.setUint32(0, data.length);
    new Uint8Array(out.buffer).set(body, 4);
    out.setUint32(body.length + 4, Bun.hash.crc32(body));
    return new Uint8Array(out.buffer);
  };
  const header = new DataView(new ArrayBuffer(13));
  header.setUint32(0, width);
  header.setUint32(4, height);
  new Uint8Array(header.buffer).set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const bytes = new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...chunk("IHDR", new Uint8Array(header.buffer)),
    ...chunk("IDAT", deflateSync(pixels)),
    ...chunk("IEND", new Uint8Array()),
  ]);
  return new File([bytes], name, { type: "image/png" });
}
