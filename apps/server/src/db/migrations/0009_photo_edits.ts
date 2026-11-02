import type { Kysely } from "kysely";

// Edited photos (rotated, cropped). The edit is made from the original and
// stored as a new image; the photo shows that one (`image_file_id`), so
// everything that shows images works unchanged. `source_image_file_id` keeps
// the original, so the photo can be edited again from it or reset; `edit` is
// what was done (JSON: rotate, crop). Unedited photos have neither.

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable("photos")
    .addColumn("source_image_file_id", "text", (c) => c.references("image_files.id"))
    .execute();
  await db.schema.alterTable("photos").addColumn("edit", "text").execute();
  await db.schema
    .createIndex("idx_photos_source_imgfile")
    .on("photos")
    .column("source_image_file_id")
    .execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex("idx_photos_source_imgfile").execute();
  await db.schema.alterTable("photos").dropColumn("edit").execute();
  await db.schema.alterTable("photos").dropColumn("source_image_file_id").execute();
}
