import type { Section } from "@sammelband/shared";
import type { Section as SectionRow } from "../db/schema";
import { fail } from "../lib/errors";
import { emitAlbumPatch } from "../lib/events";
import { currentTenantId, tdb } from "../lib/tenant-context";
import * as imageService from "./image.service";

// An album is a list of sections: title, Markdown text, a highlight flag and
// the photos whose section_id points here. The editor keeps one empty section
// at the end only in the browser; it's created here on its first input.

export type SectionFields = { title?: string; text?: string; highlight?: boolean };

const toSection = ({ tenant_id: _, highlight, ...row }: SectionRow): Section => ({
  ...row,
  highlight: Boolean(highlight),
});

export async function listSections(albumId: string): Promise<Section[]> {
  const rows = await tdb()
    .selectFrom("sections")
    .selectAll()
    .where("album_id", "=", albumId)
    .orderBy("sort_order")
    .execute();
  return rows.map(toSection);
}

export async function getSection(id: string): Promise<Section | null> {
  const row = await tdb()
    .selectFrom("sections")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row ? toSection(row) : null;
}

async function mustGet(id: string): Promise<Section> {
  const section = await getSection(id);
  if (!section) throw fail("section_not_found");
  return section;
}

/** Add a section at the end of the album, or before another one. */
export async function createSection(input: {
  albumId: string;
  fields?: SectionFields;
  beforeId?: string;
}): Promise<Section> {
  const album = await tdb()
    .selectFrom("albums")
    .select("id")
    .where("id", "=", input.albumId)
    .executeTakeFirst();
  if (!album) throw fail("album_not_found");

  const id = Bun.randomUUIDv7();
  const now = Date.now();
  await tdb()
    .insertInto("sections")
    .values({
      id,
      tenant_id: currentTenantId(),
      album_id: input.albumId,
      sort_order: await sortOrderFor(input.albumId, input.beforeId),
      title: input.fields?.title ?? "",
      text: input.fields?.text ?? "",
      highlight: input.fields?.highlight ? 1 : 0,
      created_at: now,
      updated_at: now,
    })
    .execute();
  const section = await mustGet(id);
  await imageService.albumChanged(input.albumId);
  emitAlbumPatch(input.albumId, { sections: [section] });
  return section;
}

async function sortOrderFor(albumId: string, beforeId?: string): Promise<number> {
  const others = tdb().selectFrom("sections").select("sort_order").where("album_id", "=", albumId);
  if (!beforeId) {
    const last = await others.orderBy("sort_order", "desc").limit(1).executeTakeFirst();
    return (last?.sort_order ?? 0) + 1;
  }
  const before = await getSection(beforeId);
  if (!before || before.album_id !== albumId) throw fail("anchor_section_not_found");
  const prev = await others
    .where("sort_order", "<", before.sort_order)
    .orderBy("sort_order", "desc")
    .limit(1)
    .executeTakeFirst();
  return prev ? (prev.sort_order + before.sort_order) / 2 : before.sort_order - 1;
}

export async function updateSection(id: string, fields: SectionFields): Promise<Section> {
  const section = await mustGet(id);
  await tdb()
    .updateTable("sections")
    .set({
      ...(fields.title !== undefined && { title: fields.title }),
      ...(fields.text !== undefined && { text: fields.text }),
      ...(fields.highlight !== undefined && { highlight: fields.highlight ? 1 : 0 }),
      updated_at: Date.now(),
    })
    .where("id", "=", id)
    .execute();
  const updated = await mustGet(id);
  await imageService.albumChanged(section.album_id);
  emitAlbumPatch(section.album_id, { sections: [updated] });
  return updated;
}

/** Delete a section with its photos (and their files, unless used elsewhere). */
export async function deleteSection(id: string): Promise<void> {
  const section = await mustGet(id);
  const removedPhotos = await imageService.deletePhotosBySection(id);
  await tdb().deleteFrom("sections").where("id", "=", id).execute();
  await imageService.albumChanged(section.album_id);
  emitAlbumPatch(section.album_id, {
    removedSections: [id],
    removedPhotos,
    // The cover may have been one of the removed photos (cleared by a trigger).
    ...(removedPhotos.length > 0 && {
      album: await tdb()
        .selectFrom("albums")
        .selectAll()
        .where("id", "=", section.album_id)
        .executeTakeFirstOrThrow(),
    }),
  });
}

export async function reorderSections(
  albumId: string,
  order: { id: string; sortOrder: number }[],
): Promise<void> {
  const now = Date.now();
  await tdb()
    .transaction()
    .execute(async (trx) => {
      for (const entry of order) {
        await trx
          .updateTable("sections")
          .set({ sort_order: entry.sortOrder, updated_at: now })
          .where("id", "=", entry.id)
          .where("album_id", "=", albumId)
          .execute();
      }
    });
  const ids = order.map((e) => e.id);
  if (ids.length === 0) return;
  const rows = await tdb()
    .selectFrom("sections")
    .selectAll()
    .where("album_id", "=", albumId)
    .where("id", "in", ids)
    .execute();
  await imageService.albumChanged(albumId);
  emitAlbumPatch(albumId, { sections: rows.map(toSection) });
}
