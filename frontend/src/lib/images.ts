export const SRCSET_WIDTHS = [400, 800, 1200, 1920] as const;
export type SrcsetWidth = (typeof SRCSET_WIDTHS)[number];

export function imageSrc(filename: string, width: SrcsetWidth = 800): string {
  return `/api/images/${filename}?w=${width}`;
}

export function srcset(filename: string): string {
  return SRCSET_WIDTHS.map((w) => `${imageSrc(filename, w)} ${w}w`).join(", ");
}

export const GALLERY_SIZES = "(min-width: 900px) 30vw, 100vw";

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
