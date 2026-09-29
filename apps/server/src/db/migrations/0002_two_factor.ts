import type { Kysely } from "kysely";

// Requiring two-factor authentication, per tenant and for the whole instance.
// better-auth's twoFactor plugin creates its own table (twoFactor) and the
// user.twoFactorEnabled column. Flags are 0/1 integers, portable across
// SQLite and Postgres.

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("tenants")
    .addColumn("two_factor_required", "integer", (c) => c.notNull().defaultTo(0))
    .execute();

  // Instance-wide settings of the superadmin, one row per key (JSON values).
  await db.schema
    .createTable("instance_settings")
    .addColumn("key", "text", (c) => c.primaryKey())
    .addColumn("value", "text", (c) => c.notNull())
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("instance_settings").ifExists().execute();
  await db.schema.alterTable("tenants").dropColumn("two_factor_required").execute();
}
