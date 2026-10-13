import type { Kysely } from "kysely";

// Which version of the album an export shows: the album's `updated_at` when the
// PDF was rendered. The web app marks an export as outdated once the album has
// changed since. Null for exports made before this (the web app then uses
// `created_at`).

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("album_exports").addColumn("album_updated_at", "bigint").execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("album_exports").dropColumn("album_updated_at").execute();
}
