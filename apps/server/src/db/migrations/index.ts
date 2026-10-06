import type { Migration } from "kysely/migration";
import * as initial from "./0001_initial";
import * as twoFactor from "./0002_two_factor";
import * as sections from "./0003_sections";
import * as photoSources from "./0004_photo_sources";
import * as albumExports from "./0005_album_exports";

/**
 * All migrations, in order. Listed statically (instead of read from disk) so
 * they survive bundling. Names are stored in `kysely_migration`: never rename
 * or edit a migration that has shipped, add a new one instead.
 */
export const migrations: Record<string, Migration> = {
  "0001_initial": initial,
  "0002_two_factor": twoFactor,
  "0003_sections": sections,
  "0004_photo_sources": photoSources,
  "0005_album_exports": albumExports,
};
