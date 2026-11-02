import type { PhotoEdit } from "@sammelband/shared";

// The geometry of the photo editor (editor/photo-edit-dialog.svelte): a
// quarter turn, then a crop as fractions of the turned image. The preview and
// the saved result are drawn by the same function, so they match exactly.

export type Rotation = PhotoEdit["rotate"];
export type Crop = PhotoEdit["crop"];
export type Size = { w: number; h: number };

/** Largest result, in pixels: what phones' browsers can still draw (iOS caps canvases near 16.7 MP). */
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 16_384;
/** Smallest crop, as a fraction of the shorter side. */
const MIN_CROP = 0.05;

export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** The image's size after turning it. */
export function turnedSize(image: Size, rotate: Rotation): Size {
  return rotate % 180 === 0 ? image : { w: image.h, h: image.w };
}

/** The same part of the image after a quarter turn clockwise (`by` 90) or back (-90). */
export function turnCrop(c: Crop, by: 90 | -90): Crop {
  return by === 90
    ? { x: 1 - (c.y + c.h), y: c.x, w: c.h, h: c.w }
    : { x: c.y, y: 1 - (c.x + c.w), w: c.h, h: c.w };
}

export const nextRotation = (r: Rotation, by: 90 | -90): Rotation =>
  ((r + by + 360) % 360) as Rotation;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The largest crop of `ratio` (width / height, in pixels) centred on `c`,
 * inside the image; `c` as it is for a free crop (ratio null).
 */
export function fitRatio(c: Crop, ratio: number | null, image: Size): Crop {
  if (ratio === null) return c;
  // In fractions: width / height = ratio * image.h / image.w.
  const r = (ratio * image.h) / image.w;
  let w = c.w;
  let h = w / r;
  if (h > c.h) {
    h = c.h;
    w = h * r;
  }
  if (w > 1) {
    w = 1;
    h = w / r;
  }
  if (h > 1) {
    h = 1;
    w = h * r;
  }
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  return {
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/** Which part of the crop is dragged: the whole frame, or an edge or corner. */
export type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * The crop after dragging `handle` by (dx, dy), fractions of the image,
 * from where the drag started (`start`); keeps `ratio` when one is set.
 */
export function dragCrop(
  start: Crop,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number | null,
  image: Size,
): Crop {
  if (handle === "move") {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    };
  }
  const minW = (MIN_CROP * Math.min(image.w, image.h)) / image.w;
  const minH = (MIN_CROP * Math.min(image.w, image.h)) / image.h;
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - minW);
  if (handle.includes("e")) right = clamp(right + dx, left + minW, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - minH);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + minH, 1);
  if (ratio === null) return { x: left, y: top, w: right - left, h: bottom - top };

  // Keep the ratio: the dragged side decides, the other follows from the
  // opposite edge or corner (which stays where it is), within the image.
  const r = (ratio * image.h) / image.w;
  let w = right - left;
  let h = bottom - top;
  const sideways = handle === "e" || handle === "w";
  const upDown = handle === "n" || handle === "s";
  if (sideways) h = w / r;
  else if (upDown) w = h * r;
  else if (w / h > r) h = w / r;
  else w = h * r;
  // Room from the fixed edges.
  const fixedX = handle.includes("w") ? start.x + start.w : handle.includes("e") ? start.x : null;
  const fixedY = handle.includes("n") ? start.y + start.h : handle.includes("s") ? start.y : null;
  const cx = start.x + start.w / 2;
  const cy = start.y + start.h / 2;
  const roomW =
    fixedX === null ? 2 * Math.min(cx, 1 - cx) : handle.includes("w") ? fixedX : 1 - fixedX;
  const roomH =
    fixedY === null ? 2 * Math.min(cy, 1 - cy) : handle.includes("n") ? fixedY : 1 - fixedY;
  const scale = Math.min(1, roomW / w, roomH / h);
  w *= scale;
  h *= scale;
  const x = fixedX === null ? cx - w / 2 : handle.includes("w") ? fixedX - w : fixedX;
  const y = fixedY === null ? cy - h / 2 : handle.includes("n") ? fixedY - h : fixedY;
  return { x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h };
}

/**
 * Draw `source` turned by `rotate` and cut to `crop` (null: the whole turned
 * image) onto a new canvas, at most `maxSide` pixels on its longer side
 * (and never more than phones can draw).
 */
export function render(
  source: HTMLImageElement,
  rotate: Rotation,
  crop: Crop | null,
  maxSide = MAX_SIDE,
): HTMLCanvasElement {
  const image = { w: source.naturalWidth, h: source.naturalHeight };
  const turned = turnedSize(image, rotate);
  const c = crop ?? FULL;
  const cw = c.w * turned.w;
  const ch = c.h * turned.h;
  const scale = Math.min(1, maxSide / Math.max(cw, ch), Math.sqrt(MAX_PIXELS / (cw * ch)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cw * scale));
  canvas.height = Math.max(1, Math.round(ch * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.scale(scale, scale);
  // To the crop's corner in the turned image, then turn the image into place.
  ctx.translate(-c.x * turned.w, -c.y * turned.h);
  if (rotate === 90) ctx.translate(turned.w, 0);
  else if (rotate === 180) ctx.translate(turned.w, turned.h);
  else if (rotate === 270) ctx.translate(0, turned.h);
  ctx.rotate((rotate * Math.PI) / 180);
  ctx.drawImage(source, 0, 0, image.w, image.h);
  return canvas;
}

/** Whether an edit changes anything. */
export const isEdited = (rotate: Rotation, crop: Crop) =>
  rotate !== 0 || crop.x > 0.0005 || crop.y > 0.0005 || crop.w < 0.9995 || crop.h < 0.9995;
