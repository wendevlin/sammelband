import type { Kysely } from "kysely";

// Public links to an album or a folder (with its sub-folders). The token is
// stored as is, so people can copy a link again later; revoking deletes the
// row. Exactly one of album_id / folder_id is set.

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("share_links")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("token", "text", (c) => c.notNull().unique())
    .addColumn("album_id", "text", (c) => c.references("albums.id").onDelete("cascade"))
    .addColumn("folder_id", "text", (c) => c.references("folders.id").onDelete("cascade"))
    .addColumn("password_hash", "text")
    .addColumn("expires_at", "bigint")
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("idx_share_links_album")
    .on("share_links")
    .column("album_id")
    .execute();
  await db.schema
    .createIndex("idx_share_links_folder")
    .on("share_links")
    .column("folder_id")
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("share_links").ifExists().execute();
}
