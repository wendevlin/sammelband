import type { Kysely } from "kysely";

// Photo sources: places photos can be imported from besides uploads (Nextcloud,
// later Immich). A source is switched on per Sammelband by its admins
// (`source_settings`, with a default server people can change), and users
// connect accounts (`source_accounts`): several per source, each with its own
// server, an optional name, and credentials encrypted with SECRET_KEY.
// Imported photos are stored like uploads; nothing is served from the source.

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("source_settings")
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("source", "text", (c) => c.notNull())
    .addColumn("enabled", "integer", (c) => c.notNull().defaultTo(0))
    /** JSON, shape per source (Nextcloud: { url }, the default server). */
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
    /** What the user called it ("Family", "Work"), or null. */
    .addColumn("name", "text")
    /** The account at the source, e.g. the Nextcloud login name. */
    .addColumn("label", "text", (c) => c.notNull())
    /** JSON, shape per source (Nextcloud: { url }, this account's server). */
    .addColumn("config", "text", (c) => c.notNull())
    /** Encrypted JSON (lib/secret-box.ts), shape per source. */
    .addColumn("credentials", "text", (c) => c.notNull())
    /** Where the picker opened last, so it opens there again. */
    .addColumn("last_location", "text")
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addColumn("updated_at", "bigint", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("idx_source_accounts_user")
    .on("source_accounts")
    .columns(["tenant_id", "user_id"])
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("source_accounts").ifExists().execute();
  await db.schema.dropTable("source_settings").ifExists().execute();
}
