import { encode, QrCodeDataType } from "uqr";
import { MM } from "./layout";
import { COLORS } from "./theme";

// A video in the PDF: its poster as a photo, and on it a white card with a QR
// code to the video, a play mark and how long it is. The code is drawn as
// vector shapes, so it is sharp in print at any size. Its three corner squares
// have rounded corners, like the card and the app.
//
// The album link on the back is the same kind of card, without the play mark.

type Doc = PDFKit.PDFDocument;

/** The code's side: large enough for phone cameras at arm's length, never more than needed. */
const MIN_CODE = 17 * MM;
const MAX_CODE = 26 * MM;
/** Below this, a photo only gets the play mark (the small gallery on the back). */
const MIN_PHOTO_FOR_CODE = MIN_CODE * 1.6;

/** "1:23", or "1:02:03" for an hour or more. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export type VideoMark = { url: string; durationMs: number };

/**
 * The QR card at the top right of a photo at (x, y, w, h), kept inside
 * `bounds` (the area away from the page edges); a play mark on small photos,
 * and where the code would be printed a second time (`code: false`).
 */
export function drawVideoMark(
  doc: Doc,
  photo: { x: number; y: number; w: number; h: number },
  bounds: { x: number; y: number; w: number; h: number },
  video: VideoMark,
  code = true,
): void {
  // The whole photo opens the video when the PDF is read on a screen.
  doc.link(photo.x, photo.y, photo.w, photo.h, video.url);
  const short = Math.min(photo.w, photo.h);
  if (!code || short < MIN_PHOTO_FOR_CODE) {
    drawPlay(doc, photo.x + photo.w / 2, photo.y + photo.h / 2, Math.min(short * 0.14, 5 * MM));
    return;
  }

  const qr = encode(video.url, { ecc: "M", border: 0 });
  const side = Math.min(MAX_CODE, Math.max(MIN_CODE, short * 0.3));
  const module = side / qr.size;
  // Scanners need a light margin around the code: three modules of card.
  const pad = 3 * module;
  const label = Math.max(6, side * 0.1);
  const cardW = side + 2 * pad;
  const cardH = side + 2 * pad + label * 1.5;
  const inset = Math.max(2.5 * MM, short * 0.04);
  const right = Math.min(photo.x + photo.w, bounds.x + bounds.w) - inset;
  const top = Math.max(photo.y, bounds.y) + inset;
  const x = right - cardW;
  const y = top;

  doc.save();
  doc
    .roundedRect(x, y, cardW, cardH, Math.min(cardW, cardH) * 0.1)
    .fillOpacity(0.96)
    .fill(COLORS.white);
  doc.fillOpacity(1);
  drawCode(doc, qr, x + pad, y + pad, module);

  // ▶ 1:23 under the code.
  const text = formatDuration(video.durationMs);
  doc.font("bodyBold").fontSize(label).fillColor(COLORS.text);
  const textW = doc.widthOfString(text);
  const icon = label * 0.75;
  const gap = label * 0.35;
  const rowW = icon + gap + textW;
  const rowY = y + pad + side + label * 0.3;
  const rowX = x + (cardW - rowW) / 2;
  const iconY = rowY + (doc.currentLineHeight(true) - icon) / 2;
  doc
    .moveTo(rowX, iconY)
    .lineTo(rowX + icon, iconY + icon / 2)
    .lineTo(rowX, iconY + icon)
    .closePath()
    .fill(COLORS.primary);
  doc.fillColor(COLORS.text).text(text, rowX + icon + gap, rowY, { lineBreak: false });
  doc.restore();
}

/**
 * A card at (x, y), `size` square, with a QR code to `url` (the album link on
 * the back), outlined so it stands out on white paper too.
 */
export function drawLinkCode(doc: Doc, url: string, x: number, y: number, size: number): void {
  const qr = encode(url, { ecc: "M", border: 0 });
  // Scanners need a light margin around the code: three modules of card.
  const module = size / (qr.size + 6);
  doc.link(x, y, size, size, url);
  doc.save();
  doc
    .roundedRect(x, y, size, size, size * 0.1)
    .lineWidth(0.75)
    .fillAndStroke(COLORS.white, COLORS.border);
  drawCode(doc, qr, x + 3 * module, y + 3 * module, module);
  doc.restore();
}

/** The modules: runs of dark ones as rectangles, the corner squares rounded. */
function drawCode(doc: Doc, qr: ReturnType<typeof encode>, x: number, y: number, m: number) {
  const n = qr.size;
  for (let row = 0; row < n; row++) {
    let start = -1;
    for (let col = 0; col <= n; col++) {
      const dark =
        col < n && qr.data[row]?.[col] === true && qr.types[row]?.[col] !== QrCodeDataType.Position;
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        // A hair wider and taller, so neighbouring runs leave no seams.
        doc.rect(x + start * m, y + row * m, (col - start) * m + 0.05, m + 0.05).fill(COLORS.text);
        start = -1;
      }
    }
  }
  for (const [col, row] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ] as const) {
    const fx = x + col * m;
    const fy = y + row * m;
    doc.roundedRect(fx, fy, 7 * m, 7 * m, 2 * m).fill(COLORS.text);
    doc.roundedRect(fx + m, fy + m, 5 * m, 5 * m, 1.5 * m).fill(COLORS.white);
    doc.roundedRect(fx + 2 * m, fy + 2 * m, 3 * m, 3 * m, m).fill(COLORS.text);
  }
}

/** A round play button centred at (cx, cy). */
function drawPlay(doc: Doc, cx: number, cy: number, r: number): void {
  doc.save();
  doc.circle(cx, cy, r).fillOpacity(0.55).fill("#000000");
  doc.fillOpacity(1);
  const t = r * 0.5;
  doc
    .moveTo(cx - t * 0.6, cy - t)
    .lineTo(cx + t, cy)
    .lineTo(cx - t * 0.6, cy + t)
    .closePath()
    .fill(COLORS.white);
  doc.restore();
}
