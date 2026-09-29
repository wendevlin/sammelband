import type { Migration } from "kysely";
import * as initial from "./0001_initial";
import * as tenants from "./0002_tenants";
import * as sortOrder from "./0003_sort_order";
import * as shareLinks from "./0004_share_links";
import * as indexes from "./0005_indexes";
import * as coverFilename from "./0006_cover_filename";
import * as tenantTimezone from "./0007_tenant_timezone";

/**
 * All migrations, in order. Listed statically (instead of read from disk) so
 * they survive bundling. Names are stored in `kysely_migration`: never rename
 * or edit a migration that has shipped, add a new one instead.
 */
export const migrations: Record<string, Migration> = {
  "0001_initial": initial,
  "0002_tenants": tenants,
  "0003_sort_order": sortOrder,
  "0004_share_links": shareLinks,
  "0005_indexes": indexes,
  "0006_cover_filename": coverFilename,
  "0007_tenant_timezone": tenantTimezone,
};
