import { type Kysely, PostgresAdapter, sql } from "kysely";

// Domain tables. better-auth's tables (user, session, ...) are created before
// this by its own migrator, so the user foreign keys resolve.
//
// Timestamps are epoch milliseconds (bigint); sort orders are fractional
// (double precision). Everything is IF NOT EXISTS so dev databases created by
// the old db/schema.sql adopt this migration without changes.

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("folders")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("parent_id", "text", (c) => c.references("folders.id").onDelete("restrict"))
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("idx_folders_parent")
    .ifNotExists()
    .on("folders")
    .column("parent_id")
    .execute();

  await db.schema
    .createTable("albums")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("slug", "text", (c) => c.notNull())
    .addColumn("short_id", "text", (c) => c.notNull()) // URL id: /albums/<slug>-<short_id>
    .addColumn("description", "text")
    .addColumn("folder_id", "text", (c) => c.references("folders.id").onDelete("restrict"))
    .addColumn("cover_photo_id", "text") // cleared by trg_photos_clear_cover
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addColumn("updated_at", "bigint", (c) => c.notNull())
    .addUniqueConstraint("albums_folder_slug", ["folder_id", "slug"])
    .execute();
  // UNIQUE treats NULLs as distinct, so root-level slugs need their own index.
  await db.schema
    .createIndex("idx_albums_root_slug")
    .ifNotExists()
    .unique()
    .on("albums")
    .column("slug")
    .where(sql.ref("folder_id"), "is", null)
    .execute();
  await db.schema
    .createIndex("idx_albums_short_id")
    .ifNotExists()
    .unique()
    .on("albums")
    .column("short_id")
    .execute();

  // Blocks may be nested one level inside a 'group' block. parent_id integrity,
  // child cascade and the allowed types are enforced in block.service.ts.
  await db.schema
    .createTable("album_blocks")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("album_id", "text", (c) => c.notNull().references("albums.id").onDelete("cascade"))
    .addColumn("parent_id", "text")
    .addColumn("sort_order", "double precision", (c) => c.notNull())
    .addColumn("type", "text", (c) => c.notNull())
    .addColumn("content", "text", (c) => c.notNull())
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addColumn("updated_at", "bigint", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("idx_blocks_album")
    .ifNotExists()
    .on("album_blocks")
    .columns(["album_id", "sort_order"])
    .execute();
  await db.schema
    .createIndex("idx_blocks_parent")
    .ifNotExists()
    .on("album_blocks")
    .column("parent_id")
    .execute();

  // Deduplicated image files on disk (by content hash).
  await db.schema
    .createTable("image_files")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("content_hash", "text", (c) => c.notNull().unique())
    .addColumn("filename", "text", (c) => c.notNull())
    .addColumn("original_path", "text", (c) => c.notNull())
    .addColumn("width", "integer", (c) => c.notNull())
    .addColumn("height", "integer", (c) => c.notNull())
    .addColumn("file_size", "bigint", (c) => c.notNull())
    .addColumn("placeholder", "text", (c) => c.notNull())
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .execute();

  // Photos belong to a gallery block and are ordered within it.
  await db.schema
    .createTable("photos")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("album_id", "text", (c) => c.notNull().references("albums.id").onDelete("cascade"))
    .addColumn("block_id", "text", (c) =>
      c.notNull().references("album_blocks.id").onDelete("cascade"),
    )
    .addColumn("sort_order", "double precision", (c) => c.notNull())
    .addColumn("image_file_id", "text", (c) => c.notNull().references("image_files.id"))
    .addColumn("caption", "text")
    .addColumn("uploaded_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("uploaded_at", "bigint", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("idx_photos_album")
    .ifNotExists()
    .on("photos")
    .column("album_id")
    .execute();
  await db.schema
    .createIndex("idx_photos_block")
    .ifNotExists()
    .on("photos")
    .columns(["block_id", "sort_order"])
    .execute();
  await db.schema
    .createIndex("idx_photos_imgfile")
    .ifNotExists()
    .on("photos")
    .column("image_file_id")
    .execute();

  // Clear an album's cover when that photo is deleted (also when it goes via
  // the block cascade). The only dialect-specific SQL in the schema.
  if (db.getExecutor().adapter instanceof PostgresAdapter) {
    await sql`
      CREATE OR REPLACE FUNCTION photos_clear_cover() RETURNS trigger AS $$
      BEGIN
        UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = OLD.id;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql`.execute(db);
    await sql`
      CREATE OR REPLACE TRIGGER trg_photos_clear_cover
      AFTER DELETE ON photos
      FOR EACH ROW EXECUTE FUNCTION photos_clear_cover()`.execute(db);
  } else {
    await sql`
      CREATE TRIGGER IF NOT EXISTS trg_photos_clear_cover
      AFTER DELETE ON photos
      BEGIN
        UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = OLD.id;
      END`.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ["photos", "image_files", "album_blocks", "albums", "folders"]) {
    await db.schema.dropTable(table).ifExists().execute();
  }
  if (db.getExecutor().adapter instanceof PostgresAdapter) {
    await sql`DROP FUNCTION IF EXISTS photos_clear_cover`.execute(db);
  }
}
