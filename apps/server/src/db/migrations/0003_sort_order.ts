import type { Kysely } from "kysely";

// Per-user sort order of folder contents. `folder_sort` holds the chosen mode
// per container ("root" for the top level, else the folder id). Manual order
// is one fractional position per (user, item), so moving an item writes one
// row. An item belongs to one container at a time; moving it to another
// folder drops its positions (see album/folder services).

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
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
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  for (const table of ["folder_positions", "album_positions", "folder_sort"]) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
