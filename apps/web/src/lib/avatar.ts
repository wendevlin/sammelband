import { m } from "#lib/paraglide/messages.js";

/**
 * Avatars are cropped to a centered square in the browser; the server only
 * accepts squares and re-encodes them. Returns the upload body.
 */
export async function avatarForm(file: File, size = 512): Promise<FormData> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(m.profile_avatar_unsupported());
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  const fd = new FormData();
  fd.append("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
  return fd;
}
