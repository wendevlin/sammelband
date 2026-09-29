import type { Kysely } from "kysely";
import { serverTimeZone } from "../../lib/timezone";

// Each tenant's time zone: share links expire at the end of the chosen day
// there. New tenants take it from the creating browser; existing ones start
// with the server's zone, and admins can change it.

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("tenants").addColumn("timezone", "text").execute();
  await db.updateTable("tenants").set({ timezone: serverTimeZone() }).execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("tenants").dropColumn("timezone").execute();
}
