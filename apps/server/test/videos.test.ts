import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { db } from "../src/db/client";
import { parseRange } from "../src/lib/range";
import {
  exportPath,
  originalPath,
  originalsDir,
  videoPath,
  videosDir,
} from "../src/lib/storage-paths";
import { currentTenantId, runInTenant } from "../src/lib/tenant-context";
import { probe } from "../src/lib/video";
import * as albumService from "../src/services/album.service";
import * as exportService from "../src/services/export.service";
import * as imageService from "../src/services/image.service";
import { formatDuration } from "../src/services/pdf/qr";
import * as publicService from "../src/services/public.service";
import * as sectionService from "../src/services/section.service";
import * as shareService from "../src/services/share.service";
import * as storageService from "../src/services/storage.service";
import * as tenantService from "../src/services/tenant.service";
import * as videoService from "../src/services/video.service";
import { createTenant, createUser, inTenant, png, streamOf, testVideo } from "./helpers";

async function album(title = "Trip") {
  const user = await createUser();
  const created = await albumService.createAlbum({ title, folderId: null, createdBy: user.id });
  const section = await sectionService.createSection({ albumId: created.id });
  return { user, album: created, section };
}

const fileRow = (id: string) =>
  db.selectFrom("image_files").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const used = async () => (await tenantService.currentTenant()).storage_used_bytes;
const videoFiles = () => {
  try {
    return readdirSync(videosDir(currentTenantId()));
  } catch {
    return [];
  }
};

/** Whether this ffmpeg can make HDR test videos (libx265) and tone-map them (zscale). */
const canTestHdr = (() => {
  const out = (args: string[]) =>
    Bun.spawnSync(["ffmpeg", "-hide_banner", ...args]).stdout.toString();
  return /\bzscale\b/.test(out(["-filters"])) && /\blibx265\b/.test(out(["-encoders"]));
})();

/** Colour space, primaries and transfer of a file's video stream, as ffprobe reads them. */
async function colourTags(path: string): Promise<string[]> {
  const proc = Bun.spawn([
    "ffprobe",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=color_space,color_primaries,color_transfer",
    "-of",
    "json",
    path,
  ]);
  const stream = JSON.parse(await new Response(proc.stdout).text()).streams[0];
  return [stream.color_space, stream.color_primaries, stream.color_transfer];
}

/** Average brightness (0–255, full range) of the frame at `seconds` of a video or image. */
async function meanLuma(path: string, seconds: number): Promise<number> {
  const proc = Bun.spawn([
    "ffmpeg",
    "-v",
    "error",
    "-ss",
    String(seconds),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    "scale=64:-2:out_range=pc,format=gray",
    "-f",
    "rawvideo",
    "pipe:1",
  ]);
  const pixels = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  expect(pixels.length).toBeGreaterThan(0);
  return pixels.reduce((sum, v) => sum + v, 0) / pixels.length;
}

describe("videos", () => {
  test(
    "an upload shows its poster at once and plays once converted",
    inTenant(async () => {
      const { user, section } = await album();
      const bytes = await testVideo({ seconds: 2 });
      const { photo, imageFile, deduplicated } = await videoService.uploadVideo(
        streamOf(bytes),
        section.id,
        user.id,
      );
      expect(deduplicated).toBe(false);
      expect(imageFile).toMatchObject({
        kind: "video",
        video_status: "processing",
        width: 320,
        height: 240,
      });
      expect(Number(imageFile.duration_ms)).toBeGreaterThan(1900);
      expect(existsSync(originalPath(imageFile.filename))).toBe(true);
      expect(existsSync(videoPath(imageFile.video_source ?? ""))).toBe(true);

      await videoService.videosIdle();
      const row = await fileRow(imageFile.id);
      expect(row).toMatchObject({ video_status: "ready", video_source: null });
      expect(existsSync(videoPath(imageFile.video_source ?? ""))).toBe(false);
      const stored = videoPath(row.video_filename ?? "");
      const info = await probe(stored);
      expect(info).toMatchObject({ codec: "h264", width: 320, height: 240, audio: "aac" });
      // The quota counts exactly what is on disk.
      const onDisk = Bun.file(stored).size + Bun.file(originalPath(row.filename)).size;
      expect(Number(row.file_size)).toBe(onDisk);
      expect(await used()).toBe(onDisk);
      const stats = await storageService.getStorageStats();
      expect(stats.videos).toEqual({ file_count: 1, size_bytes: Bun.file(stored).size });

      const [shown] = await imageService.photosWithImage({ ids: [photo.id] });
      expect(shown).toMatchObject({
        kind: "video",
        video_status: "ready",
        video_filename: row.video_filename,
      });
    }),
  );

  test(
    "large or unusual videos are converted to at most 1080p H.264",
    inTenant(async () => {
      const { user, section } = await album();
      const bytes = await testVideo({ width: 2560, height: 1440, codec: "mpeg4", seconds: 1 });
      const { imageFile } = await videoService.uploadVideo(streamOf(bytes), section.id, user.id);
      await videoService.videosIdle();
      const row = await fileRow(imageFile.id);
      const info = await probe(videoPath(row.video_filename ?? ""));
      expect(info).toMatchObject({
        codec: "h264",
        width: 1920,
        height: 1080,
        pixelFormat: "yuv420p",
      });
    }),
  );

  test.skipIf(!canTestHdr)(
    "HDR at 60 fps becomes BT.709 at 30 fps, as bright as its poster",
    inTenant(async () => {
      const { user, section } = await album();
      const bytes = await testVideo({ width: 640, height: 360, fps: 60, hdr: true, seconds: 1 });
      const { imageFile } = await videoService.uploadVideo(streamOf(bytes), section.id, user.id);
      await videoService.videosIdle();
      const row = await fileRow(imageFile.id);
      const path = videoPath(row.video_filename ?? "");
      const info = await probe(path);
      expect(info).toMatchObject({ codec: "h264", hdr: false, pixelFormat: "yuv420p" });
      expect(Math.round(info?.fps ?? 0)).toBe(30);
      expect(await colourTags(path)).toEqual(["bt709", "bt709", "bt709"]);
      // The poster is tone-mapped on its own path (at 0.5 s of a 1 s video);
      // a wrong colour conversion in the video shows as a big difference.
      const video = await meanLuma(path, 0.5);
      const poster = await meanLuma(originalPath(row.filename), 0);
      expect(Math.abs(video - poster)).toBeLessThan(8);
    }),
  );

  test(
    "the status shows the queue, the progress and what the conversion takes",
    inTenant(async () => {
      const { user, section } = await album();
      const first = await videoService.uploadVideo(
        streamOf(
          await testVideo({ width: 1920, height: 1080, codec: "mpeg4", seconds: 4, hue: 10 }),
        ),
        section.id,
        user.id,
      );
      const second = await videoService.uploadVideo(
        streamOf(await testVideo({ hue: 20 })),
        section.id,
        user.id,
      );
      let sawRunning = false;
      let sawWaiting = false;
      for (let i = 0; i < 400; i++) {
        const now = await videoService.videoProgress(first.photo.id);
        const next = await videoService.videoProgress(second.photo.id);
        if (now.running) {
          sawRunning = true;
          expect(now.running.mode).toBe("encode");
          expect(now.waiting).toBeNull();
          // The second waits behind it: one ahead, the running one.
          if (next.status === "processing") {
            sawWaiting = true;
            expect(next.waiting).toBe(1);
          }
        }
        if (now.status === "ready") break;
        await Bun.sleep(25);
      }
      expect(sawRunning).toBe(true);
      expect(sawWaiting).toBe(true);
      await videoService.videosIdle();
      const done = await videoService.videoProgress(first.photo.id);
      expect(done).toMatchObject({
        status: "ready",
        waiting: null,
        running: null,
        upload_bytes: null,
      });
      expect(done.cores).toBeGreaterThan(0);

      const { photo: still } = await imageService.uploadPhoto(png(), section.id, user.id);
      await expect(videoService.videoProgress(still.id)).rejects.toThrow("not a video");
    }),
  );

  test(
    "the same video again reuses the stored one",
    inTenant(async () => {
      const { user, section } = await album();
      const bytes = await testVideo({ hue: 90 });
      const first = await videoService.uploadVideo(streamOf(bytes), section.id, user.id);
      await videoService.videosIdle();
      const before = await used();
      const second = await videoService.uploadVideo(streamOf(bytes), section.id, user.id);
      expect(second.deduplicated).toBe(true);
      expect(second.imageFile.id).toBe(first.imageFile.id);
      expect(await used()).toBe(before);
      expect(videoFiles()).toHaveLength(1);
    }),
  );

  test(
    "uploading a video whose conversion failed tries again",
    inTenant(async () => {
      const { user, section } = await album();
      const bytes = await testVideo({ hue: 45 });
      const { imageFile } = await videoService.uploadVideo(streamOf(bytes), section.id, user.id);
      await videoService.videosIdle();
      // As if the conversion had failed: no video, only the poster counted.
      const row = await fileRow(imageFile.id);
      const videoSize = Bun.file(videoPath(row.video_filename ?? "")).size;
      rmSync(videoPath(row.video_filename ?? ""));
      await db
        .updateTable("image_files")
        .set({ video_status: "failed", video_filename: null, file_size: row.file_size - videoSize })
        .where("id", "=", imageFile.id)
        .execute();
      await tenantService.reconcileStorage(currentTenantId());

      const again = await videoService.uploadVideo(streamOf(bytes), section.id, user.id);
      expect(again).toMatchObject({
        deduplicated: true,
        imageFile: { video_status: "processing" },
      });
      await videoService.videosIdle();
      const fixed = await fileRow(imageFile.id);
      expect(fixed.video_status).toBe("ready");
      expect(Number(fixed.file_size)).toBe(
        Bun.file(videoPath(fixed.video_filename ?? "")).size +
          Bun.file(originalPath(fixed.filename)).size,
      );
      expect(await used()).toBe(Number(fixed.file_size));
      expect(videoFiles()).toEqual([fixed.video_filename ?? ""]);
    }),
  );

  test(
    "anything but a video is refused and leaves nothing behind",
    inTenant(async () => {
      const { user, section } = await album();
      const image = new Uint8Array(await png().arrayBuffer());
      await expect(videoService.uploadVideo(streamOf(image), section.id, user.id)).rejects.toThrow(
        "Unable to read the video",
      );
      await expect(
        videoService.uploadVideo(streamOf(new Uint8Array()), section.id, user.id),
      ).rejects.toThrow();
      expect(videoFiles()).toEqual([]);
      expect(await used()).toBe(0);
    }),
  );

  test(
    "a video that can't fit the storage limit is refused before it is received",
    inTenant(async () => {
      const { user, section } = await album();
      await db
        .updateTable("tenants")
        .set({ quota_bytes: 1000 })
        .where("id", "=", currentTenantId())
        .execute();
      const bytes = await testVideo();
      await expect(
        videoService.uploadVideo(streamOf(bytes), section.id, user.id, bytes.byteLength),
      ).rejects.toThrow("Storage quota");
      // Without a declared size, the reservation after receiving refuses it.
      await expect(videoService.uploadVideo(streamOf(bytes), section.id, user.id)).rejects.toThrow(
        "Storage quota",
      );
      expect(videoFiles()).toEqual([]);
      expect(await used()).toBe(0);
    }),
  );

  test(
    "a new poster frame replaces the old one, also as the album cover",
    inTenant(async () => {
      const { user, album: created, section } = await album();
      const bytes = await testVideo({ seconds: 3, hue: 180 });
      const { photo, imageFile } = await videoService.uploadVideo(
        streamOf(bytes),
        section.id,
        user.id,
      );
      await videoService.videosIdle();
      const updated = await videoService.setPoster(photo.id, 2500);
      expect(updated.poster_ms).toBe(2500);
      expect(updated.filename).not.toBe(imageFile.filename);
      expect(existsSync(originalPath(imageFile.filename))).toBe(false);
      expect(existsSync(originalPath(updated.filename))).toBe(true);
      expect((await albumService.getAlbum(created.id))?.cover_filename).toBe(updated.filename);
      const row = await fileRow(imageFile.id);
      expect(Number(row.file_size)).toBe(
        Bun.file(videoPath(row.video_filename ?? "")).size +
          Bun.file(originalPath(row.filename)).size,
      );

      const { photo: still } = await imageService.uploadPhoto(png(), section.id, user.id);
      await expect(videoService.setPoster(still.id, 0)).rejects.toThrow("not a video");

      // Two changes at once: one wins, and no file or byte is left over.
      await Promise.all([
        videoService.setPoster(photo.id, 500),
        videoService.setPoster(photo.id, 1500),
      ]);
      const after = await fileRow(imageFile.id);
      expect(readdirSync(originalsDir(currentTenantId())).sort()).toEqual(
        [after.filename, (await fileRow(still.image_file_id)).filename].sort(),
      );
      expect(await used()).toBe(
        Number(after.file_size) + Number((await fileRow(still.image_file_id)).file_size),
      );
    }),
  );

  test(
    "deleting a video removes its files and gives its storage back",
    inTenant(async () => {
      const { user, section } = await album();
      const { photo, imageFile } = await videoService.uploadVideo(
        streamOf(await testVideo({ hue: 270 })),
        section.id,
        user.id,
      );
      await videoService.videosIdle();
      const row = await fileRow(imageFile.id);
      await imageService.deletePhoto(photo.id);
      expect(existsSync(videoPath(row.video_filename ?? ""))).toBe(false);
      expect(existsSync(originalPath(row.filename))).toBe(false);
      expect(await used()).toBe(0);
    }),
  );

  test(
    "deleting a video while it is converted leaves nothing behind",
    inTenant(async () => {
      const { user, section } = await album();
      const { photo } = await videoService.uploadVideo(
        streamOf(await testVideo({ hue: 300 })),
        section.id,
        user.id,
      );
      await imageService.deletePhoto(photo.id);
      await videoService.videosIdle();
      expect(videoFiles()).toEqual([]);
      expect(await used()).toBe(0);
    }),
  );

  test(
    "videos are served in parts, as players ask",
    inTenant(async () => {
      const { user, section } = await album();
      const { imageFile } = await videoService.uploadVideo(
        streamOf(await testVideo({ hue: 30 })),
        section.id,
        user.id,
      );
      await videoService.videosIdle();
      const { video_filename } = await fileRow(imageFile.id);
      const name = video_filename ?? "";
      const size = Bun.file(videoPath(name)).size;

      const whole = await videoService.serveVideo(name, undefined);
      expect(whole.status).toBe(200);
      expect(whole.headers.get("Accept-Ranges")).toBe("bytes");
      const part = await videoService.serveVideo(name, "bytes=10-19");
      expect(part.status).toBe(206);
      expect(part.headers.get("Content-Range")).toBe(`bytes 10-19/${size}`);
      expect((await part.bytes()).byteLength).toBe(10);
      expect((await videoService.serveVideo(name, `bytes=${size}-`)).status).toBe(416);
      await expect(videoService.serveVideo("../x.mp4", undefined)).rejects.toThrow("not found");
    }),
  );

  test("ranges", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=90-200", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=5-1", 100)).toBe("invalid");
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(formatDuration(83_000)).toBe("1:23");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });
});

describe("videos in PDFs and public links", () => {
  /** An album with a photo and a converted video, PDF export on. */
  async function setup() {
    const tenant = await createTenant();
    const as = <T>(fn: () => Promise<T>) => runInTenant(tenant.id, fn);
    const data = await as(async () => {
      await tenantService.updateCurrentTenant({ pdfExportEnabled: true });
      const { user, album: trip, section } = await album();
      const { imageFile: still } = await imageService.uploadPhoto(png(), section.id, user.id);
      const { photo: clip } = await videoService.uploadVideo(
        streamOf(await testVideo({ hue: 120 })),
        section.id,
        user.id,
      );
      await videoService.videosIdle();
      const [shown] = await imageService.photosWithImage({ ids: [clip.id] });
      if (!shown) throw new Error("missing video");
      const other = await album("Other");
      const { photo: otherClip } = await videoService.uploadVideo(
        streamOf(await testVideo({ hue: 240 })),
        other.section.id,
        other.user.id,
      );
      await videoService.videosIdle();
      const [otherShown] = await imageService.photosWithImage({ ids: [otherClip.id] });
      return { user, trip, still, clip: shown, other: otherShown };
    });
    return { as, ...data };
  }

  const tokenOf = (url: string) => url.split("/s/")[1]?.split("?")[0] ?? "";
  const open = (token: string) => publicService.access(token, () => undefined);

  test("a PDF of an album with videos gets a video link, printed as QR codes", async () => {
    const { as, user, trip, clip } = await setup();
    const exp = await as(async () => {
      const queued = await exportService.createExport(trip.id, user.id, {
        format: "a4",
        purpose: "screen",
        captions: true,
      });
      await exportService.exportsIdle();
      const [done] = await exportService.listExports(trip.id);
      return { queued, done };
    });
    expect(exp.done?.status).toBe("done");
    const link = exp.done?.video_link;
    expect(link?.url).toContain("/s/");
    const token = tokenOf(link?.url ?? "");

    // The PDF links the video's page (QR code and link annotation).
    const pdf = await as(async () => {
      const row = await db
        .selectFrom("album_exports")
        .select("filename")
        .where("id", "=", exp.queued.id)
        .executeTakeFirstOrThrow();
      return readFileSync(exportPath(row.filename ?? "")).toString("latin1");
    });
    expect(pdf).toContain(`${token}?v=${clip.id}`);

    const links = await as(() => shareService.listShares({ albumId: trip.id }));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      videos_only: true,
      export: { id: exp.queued.id, name: "Trip" },
    });
    await as(async () => {
      await expect(shareService.deleteShare(links[0]?.id ?? "")).rejects.toThrow(
        "belongs to a PDF",
      );
    });
  });

  test("a video link shows the album's videos and nothing else", async () => {
    const { as, user, trip, still, clip, other } = await setup();
    const token = await as(async () => {
      const queued = await exportService.createExport(trip.id, user.id, {
        format: "a5",
        purpose: "home",
        captions: false,
      });
      await exportService.exportsIdle();
      return tokenOf((await exportService.listExports(trip.id))[0]?.video_link?.url ?? queued.id);
    });

    const view = await publicService.view(await open(token), {});
    expect(view.status === "ok" && view.kind).toBe("videos");
    if (view.status === "ok" && view.kind === "videos") {
      expect(view.album.title).toBe("Trip");
      expect(view.videos.map((v) => [v.id, v.video_filename])).toEqual([
        [clip.id, clip.video_filename],
      ]);
    }
    await expect(
      publicService.view(await open(token), { albumRef: trip.short_id }),
    ).rejects.toThrow("Not part");

    const played = await publicService.video(
      await open(token),
      clip.video_filename ?? "",
      "bytes=0-9",
    );
    expect(played.status).toBe(206);
    expect((await publicService.image(await open(token), clip.filename, 400, "webp")).status).toBe(
      200,
    );
    // The album's photos, and other albums' videos, stay private.
    await expect(
      publicService.image(await open(token), still.filename, 400, "webp"),
    ).rejects.toThrow("not found");
    await expect(
      publicService.video(await open(token), other?.video_filename ?? "", undefined),
    ).rejects.toThrow("not found");
  });

  test("ordinary album links play the album's videos", async () => {
    const { as, user, trip, clip, other } = await setup();
    const link = await as(() => shareService.createShare({ albumId: trip.id }, {}, user.id));
    const access = await open(tokenOf(link.url));
    const view = await publicService.view(access, {});
    if (view.status !== "ok" || view.kind !== "album") throw new Error("expected the album");
    expect(view.photos.find((p) => p.id === clip.id)).toMatchObject({
      kind: "video",
      video_filename: clip.video_filename,
    });
    expect((await publicService.video(access, clip.video_filename ?? "", undefined)).status).toBe(
      200,
    );
    await expect(
      publicService.video(access, other?.video_filename ?? "", undefined),
    ).rejects.toThrow("not found");
  });

  test("deleting the PDF deletes its video link, or keeps it if asked", async () => {
    const { as, user, trip } = await setup();
    const make = () =>
      as(async () => {
        const queued = await exportService.createExport(trip.id, user.id, {
          format: "a4",
          purpose: "home",
          captions: true,
        });
        await exportService.exportsIdle();
        const [done] = (await exportService.listExports(trip.id)).filter((e) => e.id === queued.id);
        return { id: queued.id, token: tokenOf(done?.video_link?.url ?? "") };
      });

    const dropped = await make();
    await as(() => exportService.deleteExport(dropped.id));
    await expect(open(dropped.token)).rejects.toThrow();

    const kept = await make();
    await as(() => exportService.deleteExport(kept.id, true));
    const view = await publicService.view(await open(kept.token), {});
    expect(view.status === "ok" && view.kind).toBe("videos");
    const [link] = await as(() => shareService.listShares({ albumId: trip.id }));
    expect(link).toMatchObject({ videos_only: true, export: null, label: "Trip" });
    // Now an ordinary link: it can be deleted.
    await as(() => shareService.deleteShare(link?.id ?? ""));
    await expect(open(kept.token)).rejects.toThrow();
  });

  test("albums without videos get no video link", async () => {
    const tenant = await createTenant();
    await runInTenant(tenant.id, async () => {
      await tenantService.updateCurrentTenant({ pdfExportEnabled: true });
      const { user, album: plain, section } = await album();
      await imageService.uploadPhoto(png(), section.id, user.id);
      await exportService.createExport(plain.id, user.id, {
        format: "a4",
        purpose: "home",
        captions: true,
      });
      await exportService.exportsIdle();
      expect((await exportService.listExports(plain.id))[0]?.video_link).toBeNull();
      expect(await shareService.listShares({ albumId: plain.id })).toEqual([]);
    });
  });
});
