import { getContext, setContext } from "svelte";

export const SRCSET_WIDTHS = [400, 800, 1200, 1920] as const;
export type SrcsetWidth = (typeof SRCSET_WIDTHS)[number];

export function imageSrc(filename: string, width: SrcsetWidth = 800): string {
  return `/api/images/${filename}?w=${width}`;
}

export function srcset(filename: string): string {
  return SRCSET_WIDTHS.map((w) => `${imageSrc(filename, w)} ${w}w`).join(", ");
}

export type ImageUrls = {
  src: (filename: string, width?: SrcsetWidth) => string;
  srcset: (filename: string) => string;
  /** A converted video (Photo.video_filename). */
  video: (filename: string) => string;
};

const MEDIA_BASE = Symbol("media-base");

/**
 * Serve images and videos of this subtree from `base`/images and `base`/videos
 * (public link pages use their link's routes).
 */
export function setMediaBase(base: string): void {
  setContext(MEDIA_BASE, base);
}

/**
 * Image and video URL builders for components that also render on public link
 * pages. Call during component init; defaults to the signed-in /api routes.
 */
export function imageUrls(): ImageUrls {
  const base = getContext<string | undefined>(MEDIA_BASE) ?? "/api";
  const src = (filename: string, width: SrcsetWidth = 800) =>
    `${base}/images/${filename}?w=${width}`;
  return {
    src,
    srcset: (filename) => SRCSET_WIDTHS.map((w) => `${src(filename, w)} ${w}w`).join(", "),
    video: (filename) => `${base}/videos/${filename}`,
  };
}

/** A video's length: "1:23", or "1:02:03" for an hour or more. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
