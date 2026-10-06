import type { ExportFormat } from "@sammelband/shared";
import { m } from "$lib/paraglide/messages.js";

export function formatLabel(format: ExportFormat): string {
  return {
    a4: m.export_format_a4,
    "a4-landscape": m.export_format_a4_landscape,
    a5: m.export_format_a5,
    "square-21": m.export_format_square_21,
    letter: m.export_format_letter,
  }[format]();
}
