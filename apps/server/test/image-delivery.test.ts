import { describe, expect, spyOn, test } from "bun:test";
import { readdirSync } from "node:fs";
import { imageDecoding } from "../src/lib/semaphore";
import { variantPath, variantsDir } from "../src/lib/storage-paths";
import { currentTenantId } from "../src/lib/tenant-context";
import * as albumService from "../src/services/album.service";
import * as imageService from "../src/services/image.service";
import * as imageDelivery from "../src/services/image-delivery.service";
import * as sectionService from "../src/services/section.service";
import { createUser, inTenant, png } from "./helpers";

async function upload() {
  const user = await createUser();
  const album = await albumService.createAlbum({ title: "A", folderId: null, createdBy: user.id });
  const section = await sectionService.createSection({ albumId: album.id });
  return (await imageService.uploadPhoto(png(), section.id, user.id)).imageFile;
}

/** Bytes from strings (as ASCII) and byte lists. */
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

/** The start of an ISO media file (HEIC, AVIF, …): its "ftyp" box. */
const ftyp = (major: string, ...compatible: string[]) =>
  bytes([0, 0, 0, 16 + 4 * compatible.length], "ftyp", major, [0, 0, 0, 0], ...compatible);

describe("serving images", () => {
  test(
    "an original is sent with its image type and a file name to match",
    inTenant(async () => {
      const file = await upload();
      const res = await imageDelivery.serveOriginal(file.filename);
      expect(res.headers.get("Content-Type")).toBe("image/png");
      const name = `${file.filename.replace(/\.bin$/, "")}.png`;
      expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="${name}"`);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(await png().bytes());
    }),
  );

  test("formats are told apart by their first bytes", () => {
    const cases: [Uint8Array, string | undefined][] = [
      [bytes([0xff, 0xd8, 0xff, 0xe1]), "image/jpeg"],
      [bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
      [bytes("GIF89a"), "image/gif"],
      [bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 "), "image/webp"],
      [bytes("BM", [0, 0, 0, 0]), "image/bmp"],
      [bytes("II*", [0]), "image/tiff"],
      [bytes("MM", [0], "*"), "image/tiff"],
      [ftyp("heic", "mif1", "heic"), "image/heic"],
      [ftyp("mif1", "mif1", "heic"), "image/heic"],
      [ftyp("avif", "mif1", "miaf"), "image/avif"],
      [ftyp("mif1", "mif1", "avif"), "image/avif"],
      [ftyp("mif1", "mif1", "miaf"), "image/heif"],
      [ftyp("isom", "mp41"), undefined],
      [bytes("<svg"), undefined],
      [bytes(), undefined],
    ];
    for (const [head, type] of cases) {
      expect(imageDelivery.imageFormat(head)?.type).toBe(type);
    }
  });

  test(
    "requests for a new size at the same time share one resize; the file lands complete",
    inTenant(async () => {
      const file = await upload();
      const decodes = spyOn(imageDecoding, "run");
      try {
        const responses = await Promise.all(
          Array.from({ length: 4 }, () => imageDelivery.serveVariant(file.filename, 400, "webp")),
        );
        expect(decodes).toHaveBeenCalledTimes(1);
        const bodies = await Promise.all(responses.map(async (r) => (await r.bytes()).join()));
        const onDisk = await Bun.file(variantPath(file.filename, 400, "webp")).bytes();
        expect(onDisk.length).toBeGreaterThan(0);
        expect(new Set(bodies)).toEqual(new Set([onDisk.join()]));
        // No temporary file left behind.
        expect(readdirSync(variantsDir(currentTenantId()))).toEqual([`${file.filename}_400.webp`]);

        // Later requests read the file instead of resizing again.
        await imageDelivery.serveVariant(file.filename, 400, "webp");
        expect(decodes).toHaveBeenCalledTimes(1);
      } finally {
        decodes.mockRestore();
      }
    }),
  );
});
