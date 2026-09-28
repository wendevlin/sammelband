import type { Kysely } from "kysely";

// Indexes for the queries as they run: the tenant plugin adds
// `tenant_id = ?` to everything, so lookups lead with the tenant.
// image_files is covered by its UNIQUE (tenant_id, content_hash).

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  // Folder contents: children of a folder (or the root) within a tenant,
  // albums newest first.
  await db.schema
    .createIndex("idx_albums_tenant_folder")
    .on("albums")
    .columns(["tenant_id", "folder_id", "created_at"])
    .execute();
  await db.schema
    .createIndex("idx_folders_tenant_parent")
    .on("folders")
    .columns(["tenant_id", "parent_id"])
    .execute();
  await db.schema.dropIndex("idx_albums_tenant").ifExists().execute();
  await db.schema.dropIndex("idx_folders_tenant").ifExists().execute();

  // Users of a tenant (user lists, tenant overview, deleting a tenant).
  await db.schema.createIndex("idx_user_tenant").on("user").column("tenantId").execute();

  // Deleting a tenant removes its rows by tenant_id.
  await db.schema.createIndex("idx_photos_tenant").on("photos").column("tenant_id").execute();
  await db.schema.createIndex("idx_blocks_tenant").on("album_blocks").column("tenant_id").execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  for (const index of [
    "idx_albums_tenant_folder",
    "idx_folders_tenant_parent",
    "idx_user_tenant",
    "idx_photos_tenant",
    "idx_blocks_tenant",
  ]) {
    await db.schema.dropIndex(index).ifExists().execute();
  }
  await db.schema.createIndex("idx_albums_tenant").on("albums").column("tenant_id").execute();
  await db.schema.createIndex("idx_folders_tenant").on("folders").column("tenant_id").execute();
}
