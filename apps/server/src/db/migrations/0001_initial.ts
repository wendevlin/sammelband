import { type Kysely, PostgresAdapter, sql } from "kysely";

// The domain schema. better-auth's tables (user, session, ...) are created
// before this by its own migrator, so the user foreign keys resolve.
//
// Timestamps are epoch milliseconds (bigint); sort orders and positions are
// fractional (double precision). Every content row belongs to a tenant
// ("Sammelband" in the UI); uniqueness that users see, like album slugs, is
// per tenant.

export async function up(db: Kysely<unknown>): Promise<void> {
  // --- Tenants ---------------------------------------------------------------

  await db.schema
    .createTable("tenants")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("quota_bytes", "bigint") // null = unlimited
    .addColumn("storage_used_bytes", "bigint", (c) => c.notNull().defaultTo(0))
    .addColumn("suspended_at", "bigint")
    .addColumn("created_at", "bigint", (c) => c.notNull())
    // IANA zone: share links expire at the end of the chosen day there.
    .addColumn("timezone", "text", (c) => c.notNull())
    .execute();

  // Only a hash of the invite token is stored.
  await db.schema
    .createTable("tenant_invites")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id").onDelete("cascade"))
    .addColumn("token_hash", "text", (c) => c.notNull().unique())
    .addColumn("role", "text", (c) => c.notNull())
    .addColumn("expires_at", "bigint", (c) => c.notNull())
    .addColumn("used_at", "bigint")
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("idx_tenant_invites_tenant")
    .on("tenant_invites")
    .column("tenant_id")
    .execute();

  // Users of a tenant (user lists, tenant overview, deleting a tenant).
  await db.schema.createIndex("idx_user_tenant").on("user").column("tenantId").execute();

  // --- Folders and albums ----------------------------------------------------

  await db.schema
    .createTable("folders")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("parent_id", "text", (c) => c.references("folders.id").onDelete("restrict"))
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .execute();
  // Children of a folder (or the root) within a tenant; parent_id alone for the FK.
  await db.schema
    .createIndex("idx_folders_tenant_parent")
    .on("folders")
    .columns(["tenant_id", "parent_id"])
    .execute();
  await db.schema.createIndex("idx_folders_parent").on("folders").column("parent_id").execute();

  await db.schema
    .createTable("albums")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("title", "text", (c) => c.notNull())
    .addColumn("slug", "text", (c) => c.notNull())
    .addColumn("short_id", "text", (c) => c.notNull()) // URL id: /albums/<slug>-<short_id>
    .addColumn("description", "text")
    .addColumn("folder_id", "text", (c) => c.references("folders.id").onDelete("restrict"))
    .addColumn("cover_photo_id", "text") // cleared by trg_photos_clear_cover
    // Explicit cover or first image; kept current by imageService.albumChanged().
    .addColumn("cover_filename", "text")
    .addColumn("created_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addColumn("updated_at", "bigint", (c) => c.notNull())
    .addUniqueConstraint("albums_tenant_folder_slug", ["tenant_id", "folder_id", "slug"])
    .execute();
  // UNIQUE treats NULLs as distinct, so top-level slugs need their own index.
  await db.schema
    .createIndex("idx_albums_root_slug")
    .unique()
    .on("albums")
    .columns(["tenant_id", "slug"])
    .where(sql.ref("folder_id"), "is", null)
    .execute();
  await db.schema
    .createIndex("idx_albums_short_id")
    .unique()
    .on("albums")
    .column("short_id")
    .execute();
  // Folder contents, newest first.
  await db.schema
    .createIndex("idx_albums_tenant_folder")
    .on("albums")
    .columns(["tenant_id", "folder_id", "created_at"])
    .execute();

  // --- Blocks and photos -----------------------------------------------------

  // Blocks may be nested one level inside a 'group' block. parent_id integrity,
  // child cascade and the allowed types are enforced in block.service.ts.
  await db.schema
    .createTable("album_blocks")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
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
    .on("album_blocks")
    .columns(["album_id", "sort_order"])
    .execute();
  await db.schema.createIndex("idx_blocks_parent").on("album_blocks").column("parent_id").execute();
  await db.schema.createIndex("idx_blocks_tenant").on("album_blocks").column("tenant_id").execute();

  // Image files on disk, deduplicated by content hash within a tenant. Paths
  // are derived from tenant + filename (lib/storage-paths.ts).
  await db.schema
    .createTable("image_files")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("content_hash", "text", (c) => c.notNull())
    .addColumn("filename", "text", (c) => c.notNull())
    .addColumn("width", "integer", (c) => c.notNull())
    .addColumn("height", "integer", (c) => c.notNull())
    .addColumn("file_size", "bigint", (c) => c.notNull())
    .addColumn("placeholder", "text", (c) => c.notNull())
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addUniqueConstraint("image_files_tenant_hash", ["tenant_id", "content_hash"])
    .execute();

  // Photos belong to a gallery block and are ordered within it.
  await db.schema
    .createTable("photos")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
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
  await db.schema.createIndex("idx_photos_album").on("photos").column("album_id").execute();
  await db.schema
    .createIndex("idx_photos_block")
    .on("photos")
    .columns(["block_id", "sort_order"])
    .execute();
  await db.schema.createIndex("idx_photos_imgfile").on("photos").column("image_file_id").execute();
  await db.schema.createIndex("idx_photos_tenant").on("photos").column("tenant_id").execute();

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
      CREATE TRIGGER trg_photos_clear_cover
      AFTER DELETE ON photos
      FOR EACH ROW EXECUTE FUNCTION photos_clear_cover()`.execute(db);
  } else {
    await sql`
      CREATE TRIGGER trg_photos_clear_cover
      AFTER DELETE ON photos
      BEGIN
        UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = OLD.id;
      END`.execute(db);
  }

  // --- Per-user sort order -----------------------------------------------------

  // `folder_sort` holds the chosen mode per container ("root" for the top
  // level, else the folder id). Manual order is one fractional position per
  // (user, item), so moving an item writes one row. Moving an item to another
  // folder drops its positions (see album/folder services).
  await db.schema
    .createTable("folder_sort")
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("folder_key", "text", (c) => c.notNull())
    .addColumn("mode", "text", (c) => c.notNull())
    .addPrimaryKeyConstraint("folder_sort_pk", ["user_id", "folder_key"])
    .execute();

  for (const kind of ["album", "folder"] as const) {
    const table = `${kind}_positions`;
    const target = kind === "album" ? "albums.id" : "folders.id";
    await db.schema
      .createTable(table)
      .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
      .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
      .addColumn(`${kind}_id`, "text", (c) => c.notNull().references(target).onDelete("cascade"))
      .addColumn("position", "double precision", (c) => c.notNull())
      .addPrimaryKeyConstraint(`${table}_pk`, ["user_id", `${kind}_id`])
      .execute();
    await db.schema.createIndex(`idx_${table}_item`).on(table).column(`${kind}_id`).execute();
  }

  // --- Public links ----------------------------------------------------------

  // Links to an album or a folder (with its sub-folders); exactly one of
  // album_id / folder_id is set. The token is stored as is, so people can copy
  // a link again later; revoking deletes the row.
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

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of [
    "share_links",
    "folder_positions",
    "album_positions",
    "folder_sort",
    "photos",
    "image_files",
    "album_blocks",
    "albums",
    "folders",
    "tenant_invites",
    "tenants",
  ]) {
    await db.schema.dropTable(table).ifExists().execute();
  }
  await db.schema.dropIndex("idx_user_tenant").ifExists().execute();
  if (db.getExecutor().adapter instanceof PostgresAdapter) {
    await sql`DROP FUNCTION IF EXISTS photos_clear_cover`.execute(db);
  }
}
