import type { Kysely } from "kysely";

// PDF export of albums: admins switch it on per Sammelband, users export an
// album, and the files stay with the album until someone deletes them.
// `options` is JSON (quality, captions; later e.g. bleed for a print service).

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("tenants")
    .addColumn("pdf_export_enabled", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  await db.schema
    .createTable("album_exports")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("album_id", "text", (c) => c.notNull().references("albums.id").onDelete("cascade"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("format", "text", (c) => c.notNull())
    .addColumn("options", "text", (c) => c.notNull())
    /** queued | running | done | failed */
    .addColumn("status", "text", (c) => c.notNull())
    .addColumn("progress", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("error_code", "text")
    .addColumn("page_count", "integer")
    /** Counted against the tenant's quota once the file is written. */
    .addColumn("file_size", "bigint")
    /** "<uuid>.pdf" under the tenant's exports directory, once done. */
    .addColumn("filename", "text")
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addColumn("finished_at", "bigint")
    .execute();
  await db.schema
    .createIndex("idx_album_exports_album")
    .on("album_exports")
    .columns(["tenant_id", "album_id"])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("album_exports").ifExists().execute();
  await db.schema.alterTable("tenants").dropColumn("pdf_export_enabled").execute();
}
