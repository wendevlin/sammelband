import type { Kysely } from "kysely";

// Print profiles for the PDF export. The built-in ones live in the code
// (shared export.ts); a Sammelband's admins switch off those nobody there
// needs (`tenants.disabled_export_profiles`, a JSON list of ids, so new
// built-in profiles start switched on) and add their own (`export_profiles`,
// the profile as JSON in `spec`).
//
// An export keeps what it was made with: `profile` is the profile as JSON
// at the time (exports from before have none and stand for their built-in
// profile, from `format` and the purpose in `options`). A separate cover is
// a second file (`cover_filename`); `warnings` is a JSON list of hints
// (blank pages added, photos cropped).

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("tenants")
    .addColumn("disabled_export_profiles", "text", (c) => c.notNull().defaultTo("[]"))
    .execute();

  await db.schema
    .createTable("export_profiles")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("spec", "text", (c) => c.notNull())
    .addColumn("enabled", "integer", (c) => c.notNull().defaultTo(1))
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addColumn("updated_at", "bigint", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("idx_export_profiles_tenant")
    .on("export_profiles")
    .column("tenant_id")
    .execute();

  await db.schema.alterTable("album_exports").addColumn("profile", "text").execute();
  await db.schema.alterTable("album_exports").addColumn("cover_filename", "text").execute();
  await db.schema.alterTable("album_exports").addColumn("warnings", "text").execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("album_exports").dropColumn("warnings").execute();
  await db.schema.alterTable("album_exports").dropColumn("cover_filename").execute();
  await db.schema.alterTable("album_exports").dropColumn("profile").execute();
  await db.schema.dropTable("export_profiles").ifExists().execute();
  await db.schema.alterTable("tenants").dropColumn("disabled_export_profiles").execute();
}
