import type { Kysely } from "kysely";

// Videos. A video is an image_files row like a photo: its `filename` is a
// still frame (the poster), so thumbnails, covers and the PDF work unchanged,
// and the video itself is stored next to it. Uploads keep their file under
// `video_source` until the background job has converted it to `video_filename`.
//
// PDF exports with videos get a public link of their own (`export_id`) that
// only shows the album's videos (`videos_only`): the PDF prints QR codes to it.
// `label` names the PDF once it's deleted and the link is kept.

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("image_files")
    .addColumn("kind", "text", (c) => c.notNull().defaultTo("image"))
    .execute();
  for (const [column, type] of [
    ["duration_ms", "bigint"],
    ["video_filename", "text"],
    ["video_status", "text"],
    ["video_source", "text"],
    ["poster_ms", "bigint"],
  ] as const) {
    await db.schema.alterTable("image_files").addColumn(column, type).execute();
  }
  await db.schema
    .alterTable("share_links")
    .addColumn("export_id", "text", (c) => c.references("album_exports.id").onDelete("set null"))
    .execute();
  await db.schema
    .alterTable("share_links")
    .addColumn("videos_only", "integer", (c) => c.notNull().defaultTo(0))
    .execute();
  await db.schema.alterTable("share_links").addColumn("label", "text").execute();
  await db.schema
    .createIndex("idx_share_links_export")
    .on("share_links")
    .column("export_id")
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("idx_share_links_export").execute();
  for (const column of ["label", "videos_only", "export_id"]) {
    await db.schema.alterTable("share_links").dropColumn(column).execute();
  }
  for (const column of [
    "poster_ms",
    "video_source",
    "video_status",
    "video_filename",
    "duration_ms",
    "kind",
  ]) {
    await db.schema.alterTable("image_files").dropColumn(column).execute();
  }
}
