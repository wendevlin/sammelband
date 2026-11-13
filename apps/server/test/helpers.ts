import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
  "album_exports",
  "export_profiles",
  "source_accounts",
  "source_settings",
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

const videos = new Map<string, Promise<Uint8Array>>();

/**
 * A short test video made with ffmpeg (cached per set of options): a moving
 * test pattern of `seconds` with a tone, H.264 unless `codec` says otherwise.
 * `hue` makes different content, hence a different hash. `hdr` films it as a
 * phone does, in place of `codec`: 10-bit HEVC tagged as HDR (PQ, BT.2020).
 */
export function testVideo({
  seconds = 2,
  width = 320,
  height = 240,
  hue = 0,
  codec = "libx264",
  bitrate = "",
  fps = 25,
  hdr = false,
}: {
  seconds?: number;
  width?: number;
  height?: number;
  hue?: number;
  codec?: string;
  bitrate?: string;
  fps?: number;
  hdr?: boolean;
} = {}): Promise<Uint8Array> {
  const key = JSON.stringify([seconds, width, height, hue, codec, bitrate, fps, hdr]);
  let made = videos.get(key);
  if (!made) {
    made = (async () => {
      const dir = mkdtempSync(join(tmpdir(), "sammelband-video-"));
      const out = join(dir, "test.mp4");
      const proc = Bun.spawn(
        [
          "ffmpeg",
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          `testsrc2=size=${width}x${height}:rate=${fps},hue=h=${hue}`,
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440",
          "-t",
          String(seconds),
          ...(hdr
            ? [
                "-c:v",
                "libx265",
                // In the bitstream too: some ffmpeg builds don't pass the
                // options below on to x265, and the file then isn't HDR.
                "-x265-params",
                "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc",
                "-pix_fmt",
                "yuv420p10le",
                "-color_primaries",
                "bt2020",
                "-color_trc",
                "smpte2084",
                "-colorspace",
                "bt2020nc",
              ]
            : ["-c:v", codec, "-pix_fmt", "yuv420p"]),
          ...(bitrate ? ["-b:v", bitrate] : []),
          "-c:a",
          "aac",
          out,
        ],
        { stderr: "pipe" },
      );
      if ((await proc.exited) !== 0) throw new Error(await new Response(proc.stderr).text());
      const bytes = await Bun.file(out).bytes();
      rmSync(dir, { recursive: true, force: true });
      return bytes;
    })();
    videos.set(key, made);
  }
  return made;
}

/** Bytes as a request body stream, as an upload arrives. */
export function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([new Uint8Array(bytes)]).stream();
}
