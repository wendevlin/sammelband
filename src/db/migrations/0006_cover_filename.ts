import type { Kysely } from "kysely";

// Store each album's cover image filename instead of looking it up per album
// on every library page (imageService.albumChanged keeps it current). The
// backfill repeats the lookup here, so this migration doesn't depend on
// service code that may change later.

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("albums").addColumn("cover_filename", "text").execute();

  const albums = await db.selectFrom("albums").select(["id", "cover_photo_id"]).execute();
  for (const album of albums) {
    const chosen = album.cover_photo_id
      ? await db
          .selectFrom("photos as p")
          .innerJoin("image_files as i", "i.id", "p.image_file_id")
          .select("i.filename")
          .where("p.id", "=", album.cover_photo_id)
          .executeTakeFirst()
      : undefined;
    const first =
      chosen ??
      (await db
        .selectFrom("photos as p")
        .innerJoin("image_files as i", "i.id", "p.image_file_id")
        .innerJoin("album_blocks as b", "b.id", "p.block_id")
        .select("i.filename")
        .where("p.album_id", "=", album.id)
        .orderBy("b.sort_order")
        .orderBy("p.sort_order")
        .limit(1)
        .executeTakeFirst());
    if (first) {
      await db
        .updateTable("albums")
        .set({ cover_filename: first.filename })
        .where("id", "=", album.id)
        .execute();
    }
  }
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("albums").dropColumn("cover_filename").execute();
}
