import { Semaphore } from "./semaphore";

// Videos with ffmpeg and ffprobe, which the server runs as separate programs
// (the Docker image installs them). Without them the app works as before and
// only refuses video uploads.
//
// Every video is stored in one format that plays in every browser and is small
// enough to stream: H.264 and AAC in MP4, at most 1080p and 30 frames per
// second, with the index at the front ("faststart") so playback starts before
// the whole file has loaded. A video that is already like that is only
// repackaged, which takes seconds instead of minutes. HDR videos (phones film
// in HDR) are tone-mapped, so they don't look washed out. Metadata such as the
// place a video was filmed is not kept.

/** Longest side of a stored video, in pixels: 1080p. */
const MAX_SIDE = 1920;
const MAX_FPS = 30;
/** x264 quality: higher is smaller. 26 looks fine on a screen at a few Mbit/s. */
const CRF = 26;
/** x264 speed. Slower presets save a little more space for a lot more CPU. */
const PRESET = "faster";
const AUDIO_BITRATE = "128k";
/** Sources up to this bitrate (bit/s) are good enough to keep as they are. */
const COPY_MAX_BITRATE = 8_000_000;
/** Largest poster frame, in pixels on the long side: sharp enough for print. */
const POSTER_MAX_SIDE = 3840;

/**
 * Probing and taking frames: quick, but each runs a decoder. Converting runs
 * one at a time in the video job queue (video.service.ts).
 */
export const videoTools = new Semaphore(2);

let available: boolean | null = null;

/** Whether ffmpeg and ffprobe are installed. */
export function videoToolsAvailable(): boolean {
  available ??= Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;
  return available;
}

export type VideoInfo = {
  durationMs: number;
  /** As shown, i.e. after the rotation phones store. */
  width: number;
  height: number;
  codec: string;
  pixelFormat: string;
  fps: number;
  /** bit/s of the whole file, if known. */
  bitrate: number | null;
  /** Codec of the first audio track, or null without sound. */
  audio: string | null;
  /** HDR (PQ or HLG): needs tone mapping. */
  hdr: boolean;
};

/** Error output of a failed run, for the log. */
export class VideoToolError extends Error {}

/** Run a tool and return its standard output; throws with its error output on failure. */
async function run(tool: "ffmpeg" | "ffprobe", args: string[]): Promise<string> {
  // A conversion can take minutes: give the requests of the web app priority.
  const nice = tool === "ffmpeg" && Bun.which("nice") ? ["nice", "-n", "10"] : [];
  const proc = Bun.spawn([...nice, tool, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new VideoToolError(`${tool} failed (${code}): ${stderr.slice(-2000)}`);
  return stdout;
}

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  color_transfer?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
};

function frameRate(rate: string | undefined): number {
  const [num, den] = (rate ?? "").split("/").map(Number);
  return num && den ? num / den : 0;
}

/** What a file holds, or null if it is no video ffmpeg can read. */
export async function probe(path: string): Promise<VideoInfo | null> {
  let parsed: { streams?: ProbeStream[]; format?: { duration?: string; bit_rate?: string } };
  try {
    parsed = JSON.parse(
      await run("ffprobe", [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        path,
      ]),
    );
  } catch {
    return null;
  }
  const streams = parsed.streams ?? [];
  // A cover image embedded in an audio file is a "video" stream too.
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video?.width || !video.height) return null;
  const seconds = Number(parsed.format?.duration ?? video.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const rotation = Math.abs(
    Number(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0) ||
      Number(video.tags?.rotate ?? 0),
  );
  const sideways = rotation % 180 === 90;
  const bitrate = Number(parsed.format?.bit_rate);
  return {
    durationMs: Math.round(seconds * 1000),
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    codec: video.codec_name ?? "",
    pixelFormat: video.pix_fmt ?? "",
    fps: frameRate(video.avg_frame_rate) || frameRate(video.r_frame_rate),
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? bitrate : null,
    audio: streams.find((s) => s.codec_type === "audio")?.codec_name ?? null,
    hdr: video.color_transfer === "smpte2084" || video.color_transfer === "arib-std-b67",
  };
}

let zscale: Promise<boolean> | null = null;

/** Whether this ffmpeg can tone-map HDR (its zscale filter needs libzimg). */
function canToneMap(): Promise<boolean> {
  zscale ??= run("ffmpeg", ["-hide_banner", "-filters"])
    .then((out) => /\bzscale\b/.test(out))
    .catch(() => false);
  return zscale;
}

/** Filters that turn HDR into ordinary (SDR) colours, or none. */
async function toneMap(info: VideoInfo): Promise<string[]> {
  if (!info.hdr || !(await canToneMap())) return [];
  return [
    "zscale=t=linear:npl=100",
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
  ];
}

/** Shrink to fit `max` on both sides, never enlarge; even sizes for H.264. */
const fit = (max: number) =>
  `scale=w='min(iw,${max})':h='min(ih,${max})':force_original_aspect_ratio=decrease:force_divisible_by=2`;

/** Whether the file can be kept as it is, only repackaged. */
export function playableAsIs(info: VideoInfo): boolean {
  return (
    info.codec === "h264" &&
    info.pixelFormat === "yuv420p" &&
    !info.hdr &&
    Math.max(info.width, info.height) <= MAX_SIDE &&
    info.fps <= MAX_FPS + 1 &&
    info.bitrate !== null &&
    info.bitrate <= COPY_MAX_BITRATE &&
    (info.audio === null || info.audio === "aac")
  );
}

/** Store `source` as an MP4 at `out` (see the top of the file). */
export async function convert(source: string, out: string, info: VideoInfo): Promise<void> {
  const common = [
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-map_metadata",
    "-1",
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
  ];
  if (playableAsIs(info)) {
    await run("ffmpeg", ["-v", "error", "-y", "-i", source, "-c", "copy", ...common, out]);
    return;
  }
  const filters = [...(await toneMap(info)), fit(MAX_SIDE), "setsar=1", "format=yuv420p"];
  await run("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    source,
    "-vf",
    filters.join(","),
    "-fpsmax",
    String(MAX_FPS),
    "-c:v",
    "libx264",
    "-preset",
    PRESET,
    "-crf",
    String(CRF),
    "-profile:v",
    "high",
    "-c:a",
    "aac",
    "-b:a",
    AUDIO_BITRATE,
    "-ac",
    "2",
    ...common,
    out,
  ]);
}

/** A still frame at `ms` as JPEG bytes (the poster), the first frame if `ms` is past the end. */
export async function frameAt(path: string, ms: number, info: VideoInfo): Promise<Uint8Array> {
  const filters = [...(await toneMap(info)), fit(POSTER_MAX_SIDE)].join(",");
  const grab = async (at: number) =>
    new Uint8Array(
      await new Response(
        Bun.spawn(
          [
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            (at / 1000).toFixed(3),
            "-i",
            path,
            "-frames:v",
            "1",
            "-vf",
            filters,
            "-q:v",
            "2",
            "-f",
            "image2",
            "-c:v",
            "mjpeg",
            "pipe:1",
          ],
          { stdout: "pipe", stderr: "ignore" },
        ).stdout,
      ).arrayBuffer(),
    );
  const bytes = await grab(ms);
  if (bytes.byteLength > 0 || ms === 0) return bytes;
  return grab(0);
}

/** Where the poster is taken by default: a moment in, past a black first frame. */
export function defaultPosterMs(durationMs: number): number {
  return Math.min(1000, Math.floor(durationMs / 2));
}
