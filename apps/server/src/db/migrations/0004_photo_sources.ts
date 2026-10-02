import type { Kysely } from "kysely";

// Photo sources: places photos can be imported from besides uploads (Nextcloud,
// later Immich). A source is switched on per Sammelband by its admins
// (`source_settings`, e.g. the Nextcloud server), and each user connects their
// own account (`source_accounts`, credentials encrypted with SECRET_KEY).
// Imported photos are stored like uploads; nothing is served from the source.

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("source_settings")
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("enabled", "integer", (c) => c.notNull().defaultTo(0))
    /** JSON, shape per source (Nextcloud: { url }). */
    .addColumn("config", "text", (c) => c.notNull())
    .addColumn("updated_at", "bigint", (c) => c.notNull())
    .addPrimaryKeyConstraint("source_settings_pk", ["tenant_id", "source"])
    .execute();

  await db.schema
    .createTable("source_accounts")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("user_id", "text", (c) => c.notNull().references("user.id").onDelete("cascade"))
    .addColumn("source", "text", (c) => c.notNull())
    /** Shown to the user, e.g. the Nextcloud login name. */
    .addColumn("label", "text", (c) => c.notNull())
    /** Encrypted JSON (lib/secret-box.ts), shape per source. */
    .addColumn("credentials", "text", (c) => c.notNull())
    /** Where the picker opened last, so it opens there again. */
    .addColumn("last_location", "text")
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addColumn("updated_at", "bigint", (c) => c.notNull())
    .addUniqueConstraint("source_accounts_user_source", ["user_id", "source"])
    .execute();
  await db.schema
    .createIndex("idx_source_accounts_tenant")
    .on("source_accounts")
    .columns(["tenant_id", "source"])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("source_accounts").ifExists().execute();
  await db.schema.dropTable("source_settings").ifExists().execute();
}
