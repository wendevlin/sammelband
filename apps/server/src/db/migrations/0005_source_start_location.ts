import type { Kysely } from "kysely";

// The picker no longer reopens where it was last time (the web app remembers
// that while an album is being edited); instead each account can have a start
// folder, chosen in the profile.

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("source_accounts").addColumn("start_location", "text").execute();
  await db.schema.alterTable("source_accounts").dropColumn("last_location").execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("source_accounts").addColumn("last_location", "text").execute();
  await db.schema.alterTable("source_accounts").dropColumn("start_location").execute();
}
