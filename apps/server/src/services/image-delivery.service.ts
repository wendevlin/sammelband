import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { isSrcsetWidth, type SrcsetWidth } from "../config";
import { fail } from "../lib/errors";
import { imageDecoding } from "../lib/semaphore";
import { originalPath, variantPath, variantsDir } from "../lib/storage-paths";
import { currentTenantId, tdb } from "../lib/tenant-context";

// Serving image files of the current tenant: resized versions (created on
// first request and cached on disk) and originals.

// Stored filenames are "<uuid>.bin". Anything else (e.g. "../") is rejected
// before it reaches the filesystem.
const FILENAME_RE = /^[0-9a-f-]{36}\.bin$/;

/** 404 unless the image exists in the current tenant (on top of the tenant path). */
async function assertImage(filename: string): Promise<void> {
  if (!FILENAME_RE.test(filename)) throw fail("image_not_found");
  const row = await tdb()
    .selectFrom("image_files")
    .select("id")
    .where("filename", "=", filename)
    .executeTakeFirst();
  if (!row) throw fail("image_not_found");
}

const IMAGE_CACHE = "private, max-age=31536000, immutable";

/**
 * Variants being created, by path (which includes the tenant): requests that
 * arrive meanwhile wait for the same result instead of decoding again.
 */
const creating = new Map<string, Promise<Uint8Array>>();

export async function serveVariant(
  filename: string,
  width: number,
  format: "webp" | "jpeg" = "webp",
): Promise<Response> {
  if (!isSrcsetWidth(width)) throw fail("unsupported_width");
  await assertImage(filename);
  const path = variantPath(filename, width, format);
  const headers = { "Content-Type": `image/${format}`, "Cache-Control": IMAGE_CACHE };
  // Variants only appear on disk complete (see createVariant).
  const cached = Bun.file(path);
  if (await cached.exists()) return new Response(cached, { headers });

  let output = creating.get(path);
  if (!output) {
    output = createVariant(filename, path, width, format).finally(() => creating.delete(path));
    creating.set(path, output);
  }
  return new Response((await output) as BodyInit, { headers });
}

async function createVariant(
  filename: string,
  path: string,
  width: SrcsetWidth,
  format: "webp" | "jpeg",
): Promise<Uint8Array> {
  const original = originalPath(filename);
  if (!existsSync(original)) throw fail("image_not_found");
  const output = await imageDecoding.run(() => {
    const pipeline = new Bun.Image(original).resize(width);
    return format === "webp"
      ? pipeline.webp({ quality: 80 }).bytes()
      : pipeline.jpeg({ quality: 85 }).bytes();
  });
  // Written under a name of its own and renamed into place (atomic within a
  // directory), so a concurrent request never streams a half-written file.
  mkdirSync(variantsDir(currentTenantId()), { recursive: true });
  const temporary = `${path}.${Bun.randomUUIDv7()}.tmp`;
  try {
    await Bun.write(temporary, output);
    renameSync(temporary, path);
  } catch (err) {
    rmSync(temporary, { force: true });
    throw err;
  }
  return output;
}

type ImageFormat = { type: string; extension: string };

const JPEG = { type: "image/jpeg", extension: "jpg" };
const PNG = { type: "image/png", extension: "png" };
const GIF = { type: "image/gif", extension: "gif" };
const WEBP = { type: "image/webp", extension: "webp" };
const BMP = { type: "image/bmp", extension: "bmp" };
const TIFF = { type: "image/tiff", extension: "tif" };
const HEIC = { type: "image/heic", extension: "heic" };
const HEIF = { type: "image/heif", extension: "heif" };
const AVIF = { type: "image/avif", extension: "avif" };

// HEIC, HEIF and AVIF are ISO media files: an "ftyp" box lists brands, the
// main one first. Specific brands win over the generic image brands.
const SPECIFIC_BRANDS: Record<string, ImageFormat> = {
  avif: AVIF,
  avis: AVIF,
  heic: HEIC,
  heix: HEIC,
  heim: HEIC,
  heis: HEIC,
  hevc: HEIC,
  hevx: HEIC,
};
const GENERIC_BRANDS: Record<string, ImageFormat> = { mif1: HEIF, msf1: HEIF };

/** Bytes `imageFormat` needs from the start of a file. */
const IMAGE_FORMAT_BYTES = 64;

/** The format of an image file from its first bytes, or null if unknown. */
export function imageFormat(head: Uint8Array): ImageFormat | null {
  const text = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (starts(0xff, 0xd8, 0xff)) return JPEG;
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return PNG;
  if (text(0, 4) === "GIF8") return GIF;
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return WEBP;
  if (text(0, 4) === "II*\0" || text(0, 4) === "MM\0*") return TIFF;
  if (text(0, 2) === "BM") return BMP;
  if (head.length >= 12 && text(4, 8) === "ftyp") {
    const boxSize = new DataView(head.buffer, head.byteOffset, 4).getUint32(0);
    const end = Math.min(boxSize, head.length);
    // Major brand, minor version, then the compatible brands.
    const brands = [text(8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(text(i, i + 4));
    for (const known of [SPECIFIC_BRANDS, GENERIC_BRANDS]) {
      const brand = brands.find((b) => known[b]);
      if (brand) return known[brand] ?? null;
    }
  }
  return null;
}

/**
 * The file as uploaded. Stored as "<uuid>.bin", so the type comes from its
 * first bytes; the file name gives "save as" a matching extension.
 */
export async function serveOriginal(filename: string): Promise<Response> {
  await assertImage(filename);
  const file = Bun.file(originalPath(filename));
  if (!(await file.exists())) throw fail("image_not_found");
  const format = imageFormat(await file.slice(0, IMAGE_FORMAT_BYTES).bytes());
  const name = `${filename.slice(0, -".bin".length)}.${format?.extension ?? "bin"}`;
  return new Response(file, {
    headers: {
      "Content-Type": format?.type ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": IMAGE_CACHE,
    },
  });
}
