import { existsSync, mkdirSync } from "node:fs";
import { isSrcsetWidth, type SrcsetWidth } from "../config";
import { AppError } from "../lib/errors";
import { originalPath, variantPath, variantsDir } from "../lib/storage-paths";
import { currentTenantId, tdb } from "../lib/tenant-context";

// Serving image files of the current tenant: resized versions (created on
// first request and cached on disk) and originals.

// Stored filenames are "<uuid>.bin". Anything else (e.g. "../") is rejected
// before it reaches the filesystem.
const FILENAME_RE = /^[0-9a-f-]{36}\.bin$/;

/** 404 unless the image exists in the current tenant (on top of the tenant path). */
async function assertImage(filename: string): Promise<void> {
  if (!FILENAME_RE.test(filename)) throw new AppError(404, "Image not found");
  const row = await tdb()
    .selectFrom("image_files")
    .select("id")
    .where("filename", "=", filename)
    .executeTakeFirst();
  if (!row) throw new AppError(404, "Image not found");
}

const IMAGE_CACHE = "private, max-age=31536000, immutable";

export async function serveVariant(
  filename: string,
  width: number,
  format: "webp" | "jpeg" = "webp",
): Promise<Response> {
  if (!isSrcsetWidth(width)) throw new AppError(400, "Unsupported width");
  await assertImage(filename);
  const path = variantPath(filename, width, format);
  const headers = { "Content-Type": `image/${format}`, "Cache-Control": IMAGE_CACHE };
  const cached = Bun.file(path);
  if (await cached.exists()) return new Response(cached, { headers });

  const original = originalPath(filename);
  if (!existsSync(original)) throw new AppError(404, "Image not found");

  const pipeline = new Bun.Image(original).resize(width as SrcsetWidth);
  const output =
    format === "webp"
      ? await pipeline.webp({ quality: 80 }).bytes()
      : await pipeline.jpeg({ quality: 85 }).bytes();

  mkdirSync(variantsDir(currentTenantId()), { recursive: true });
  await Bun.write(path, output);
  return new Response(output as BodyInit, { headers });
}

export async function serveOriginal(filename: string): Promise<Response> {
  await assertImage(filename);
  const file = Bun.file(originalPath(filename));
  if (!(await file.exists())) throw new AppError(404, "Image not found");
  return new Response(file, { headers: { "Cache-Control": IMAGE_CACHE } });
}
