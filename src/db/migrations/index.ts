import type { Migration } from "kysely";
import * as initial from "./0001_initial";
import * as tenants from "./0002_tenants";
import * as sortOrder from "./0003_sort_order";

/**
 * All migrations, in order. Listed statically (instead of read from disk) so
 * they survive bundling. Names are stored in `kysely_migration`: never rename
 * or edit a migration that has shipped, add a new one instead.
 */
export const migrations: Record<string, Migration> = {
  "0001_initial": initial,
  "0002_tenants": tenants,
  "0003_sort_order": sortOrder,
};
