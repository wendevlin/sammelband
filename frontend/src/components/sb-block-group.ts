import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Photo } from "../types";

export type GroupBackground =
  | "none"
  | "auto"
  | "neutral"
  | "blue"
  | "green"
  | "amber"
  | "rose";

// Preset → Web Awesome "quiet" fill token: subtle backgrounds designed to keep
// text readable, and they flip automatically in dark mode.
const PRESET_FILL: Record<string, string> = {
  neutral: "var(--wa-color-neutral-fill-quiet)",
  blue: "var(--wa-color-brand-fill-quiet)",
  green: "var(--wa-color-success-fill-quiet)",
  amber: "var(--wa-color-warning-fill-quiet)",
  rose: "var(--wa-color-danger-fill-quiet)",
};

/**
 * Container that wraps a group block's children with a border and an optional
 * background. "auto" derives a hue from the group's gallery placeholders and
 * renders it at a theme-controlled lightness/saturation (--sb-tint-* in
 * global.css) so text stays readable; with no photos it falls back to neutral.
 */
@customElement("sb-block-group")
export class sbBlockGroup extends LitElement {
  static override styles = css`
    :host {
      display: block;
      margin: var(--wa-space-m) 0;
    }
    .group {
      border: 1px solid var(--wa-color-surface-border);
      border-radius: var(--wa-border-radius-l);
      padding: var(--wa-space-s) var(--wa-space-l);
      background: var(--sb-group-bg, transparent);
    }
  `;

  @property({ type: String }) background: GroupBackground = "none";
  @property({ type: Array }) photos: Photo[] = [];
  @state() private autoHue: number | null = null;

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("photos") || changed.has("background")) {
      if (this.background === "auto") void this.computeHue();
      else this.applyBg();
    }
  }

  private applyBg(): void {
    let bg = "transparent";
    const preset = PRESET_FILL[this.background];
    if (preset) {
      bg = preset;
    } else if (this.background === "auto") {
      bg =
        this.autoHue === null
          ? PRESET_FILL.neutral!
          : `hsl(${this.autoHue} var(--sb-tint-s) var(--sb-tint-l))`;
    }
    this.style.setProperty("--sb-group-bg", bg);
  }

  private async computeHue(): Promise<void> {
    const srcs = this.photos
      .slice(0, 6)
      .map((p) => p.placeholder)
      .filter((s): s is string => Boolean(s));
    const colors = (await Promise.all(srcs.map(averageColor))).filter(
      (c): c is [number, number, number] => c !== null,
    );
    if (colors.length === 0) {
      this.autoHue = null;
      this.applyBg();
      return;
    }
    const sum = colors.reduce(
      (acc, [r, g, b]) =>
        [acc[0] + r, acc[1] + g, acc[2] + b] as [number, number, number],
      [0, 0, 0] as [number, number, number],
    );
    const n = colors.length;
    this.autoHue = rgbToHue(sum[0] / n, sum[1] / n, sum[2] / n);
    this.applyBg();
  }

  override render() {
    return html`<div class="group"><slot></slot></div>`;
  }
}

// Average color of a (tiny placeholder) image by downscaling it to 1×1.
function averageColor(src: string): Promise<[number, number, number] | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      resolve([d[0] ?? 0, d[1] ?? 0, d[2] ?? 0]);
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function rgbToHue(r: number, g: number, b: number): number {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  h = Math.round(h * 60);
  return h < 0 ? h + 360 : h;
}
