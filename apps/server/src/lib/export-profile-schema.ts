import { EXPORT_PURPOSES, type ExportProfileSpec } from "@sammelband/shared";
import { z } from "zod";

// What an own print profile may be: sizes a book can have, and rules that
// fit together. The same schema checks API input and reads stored profiles.

const mm = (min: number, max: number) => z.number().finite().min(min).max(max);

const spine = z.union([
  z.object({ fixedMm: mm(0, 200) }).strict(),
  z.object({ baseMm: mm(0, 200), perPageMm: mm(0, 5) }).strict(),
]);

const cover = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("pages") }).strict(),
  z.object({ mode: z.literal("none") }).strict(),
  z
    .object({
      mode: z.literal("separate"),
      panelWidthMm: mm(50, 1000),
      panelHeightMm: mm(50, 1000),
      bleedMm: mm(0, 50),
      spine,
    })
    .strict(),
]);

const pageCount = z.number().int().min(1).max(1000);

export const exportProfileSpecSchema: z.ZodType<ExportProfileSpec> = z
  .object({
    purpose: z.enum(EXPORT_PURPOSES),
    pageWidthMm: mm(50, 1000),
    pageHeightMm: mm(50, 1000),
    bleedMm: mm(0, 20),
    dpi: z.number().int().min(72).max(600),
    edgeToEdge: z.boolean(),
    layout: z.enum(["single", "spread"]),
    firstPageRight: z.boolean(),
    pages: z
      .object({
        min: pageCount.nullable(),
        max: pageCount.nullable(),
        step: z.number().int().min(1).max(8),
      })
      .strict(),
    gutterMm: mm(0, 50),
    logo: z.boolean(),
    cover,
  })
  .strict()
  .superRefine((spec, ctx) => {
    const { min, max, step } = spec.pages;
    if (min !== null && max !== null && min > max) {
      ctx.addIssue({ code: "custom", path: ["pages", "min"], message: "min is above max" });
    }
    if (max !== null && max < step) {
      ctx.addIssue({ code: "custom", path: ["pages", "max"], message: "max is below the step" });
    }
    if (spec.layout === "spread" && spec.pages.step % 2 !== 0) {
      // Spreads come in pairs of pages.
      ctx.addIssue({
        code: "custom",
        path: ["pages", "step"],
        message: "spreads need an even step",
      });
    }
  });

export const profileNameSchema = z.string().trim().min(1).max(100);
