import { Database as SQLite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { justify } from "@sammelband/shared";
import { Kysely } from "kysely";
import { BunSqliteDialect } from "../src/db/bun-sqlite-dialect";
import * as initial from "../src/db/migrations/0001_initial";
import * as twoFactor from "../src/db/migrations/0002_two_factor";
import type { OldBlock } from "../src/db/migrations/0003_sections";
import * as sections from "../src/db/migrations/0003_sections";
import * as albumService from "../src/services/album.service";
import * as imageService from "../src/services/image.service";
import * as sectionService from "../src/services/section.service";
import { createUser, inTenant, png } from "./helpers";

async function album() {
  const user = await createUser();
  return albumService.createAlbum({ title: "A", folderId: null, createdBy: user.id });
}

describe("sections", () => {
  test(
    "appends, inserts before another, updates and orders",
    inTenant(async () => {
      const { id: albumId } = await album();
      const a = await sectionService.createSection({ albumId, fields: { title: "Day 1" } });
      const c = await sectionService.createSection({ albumId });
      const b = await sectionService.createSection({ albumId, beforeId: c.id });
      const first = await sectionService.createSection({ albumId, beforeId: a.id });
      expect([first.sort_order, a.sort_order, b.sort_order, c.sort_order]).toEqual([0, 1, 1.5, 2]);
      expect(a).toMatchObject({ title: "Day 1", text: "", highlight: false });

      const updated = await sectionService.updateSection(c.id, { text: "Hello", highlight: true });
      expect(updated).toMatchObject({ title: "", text: "Hello", highlight: true });

      const order = (await sectionService.listSections(albumId)).map((x) => x.id);
      expect(order).toEqual([first.id, a.id, b.id, c.id]);
      await expect(sectionService.createSection({ albumId, beforeId: "missing" })).rejects.toThrow(
        "neighbouring section",
      );
    }),
  );

  test(
    "reorders within the album only",
    inTenant(async () => {
      const { id: albumId } = await album();
      const other = await album();
      const a = await sectionService.createSection({ albumId });
      const b = await sectionService.createSection({ albumId });
      const foreign = await sectionService.createSection({ albumId: other.id });

      await sectionService.reorderSections(albumId, [
        { id: a.id, sortOrder: 5 },
        { id: b.id, sortOrder: 4 },
        { id: foreign.id, sortOrder: 99 },
      ]);
      expect((await sectionService.listSections(albumId)).map((x) => x.id)).toEqual([b.id, a.id]);
      expect((await sectionService.getSection(foreign.id))?.sort_order).toBe(1);
    }),
  );

  test(
    "deleting a section removes its photos",
    inTenant(async () => {
      const user = await createUser();
      const { id: albumId } = await album();
      const keep = await sectionService.createSection({ albumId });
      const gone = await sectionService.createSection({ albumId });
      const kept = await imageService.uploadPhoto(png(), keep.id, user.id);
      await imageService.uploadPhoto(png([0, 0, 255]), gone.id, user.id);
      await sectionService.deleteSection(gone.id);
      expect((await imageService.photosWithImage({ albumId })).map((p) => p.id)).toEqual([
        kept.photo.id,
      ]);
      expect(await sectionService.listSections(albumId)).toHaveLength(1);
    }),
  );
});

// --- Migration from blocks -----------------------------------------------------

let n = 0;
function block(fields: Partial<OldBlock> & Pick<OldBlock, "type">): OldBlock {
  n++;
  return {
    id: `b${n}`,
    tenant_id: "t",
    album_id: "a",
    parent_id: null,
    sort_order: n,
    content: "{}",
    created_at: n,
    updated_at: n,
    ...fields,
  };
}
const heading = (text: string, extra: Partial<OldBlock> = {}) =>
  block({ type: "heading", content: JSON.stringify({ level: 2, text }), ...extra });
const text = (markdown: string, extra: Partial<OldBlock> = {}) =>
  block({ type: "text", content: JSON.stringify({ markdown }), ...extra });
const gallery = (extra: Partial<OldBlock> = {}) => block({ type: "gallery", ...extra });
const group = (background: string) =>
  block({ type: "group", content: JSON.stringify({ background }) });

function plan(blocks: OldBlock[], photos: { id: string; block_id: string; sort_order: number }[]) {
  let id = 0;
  // Top-level blocks in the order listed; children keep their own sort_order.
  const ordered = blocks.map((b, i) => (b.parent_id ? b : { ...b, sort_order: i }));
  return sections.planSections(ordered, photos, () => `s${++id}`);
}

describe("converting blocks into sections", () => {
  test("ungrouped blocks split at headings and where text follows photos", () => {
    const g1 = gallery();
    const g2 = gallery();
    const g3 = gallery();
    const blocks = [
      text("Intro"),
      heading("Day 1"),
      text("Morning"),
      g1,
      g2,
      text("Evening"),
      g3,
      heading(""),
      heading("Day 2"),
      heading("Day 3"),
    ];
    const photos = [
      { id: "p2", block_id: g2.id, sort_order: 1 },
      { id: "p1", block_id: g1.id, sort_order: 7 },
      { id: "p3", block_id: g3.id, sort_order: 1 },
    ];
    const result = plan(blocks, photos);
    expect(
      result.sections.map(({ id, title, text, highlight, sort_order }) => ({
        id,
        title,
        text,
        highlight,
        sort_order,
      })),
    ).toEqual([
      { id: "s1", title: "", text: "Intro", highlight: 0, sort_order: 1 },
      { id: "s2", title: "Day 1", text: "Morning", highlight: 0, sort_order: 2 },
      { id: "s3", title: "", text: "Evening", highlight: 0, sort_order: 3 },
      { id: "s4", title: "Day 2", text: "", highlight: 0, sort_order: 4 },
      { id: "s5", title: "Day 3", text: "", highlight: 0, sort_order: 5 },
    ]);
    // Galleries of a section merge in their order.
    expect(Object.fromEntries(result.photos)).toEqual({
      p1: { section_id: "s2", sort_order: 1 },
      p2: { section_id: "s2", sort_order: 2 },
      p3: { section_id: "s3", sort_order: 1 },
    });
  });

  test("a group becomes one section, highlighted unless it had no background", () => {
    const plain = group("none");
    const tinted = group("auto");
    const g = gallery({ parent_id: tinted.id, sort_order: 1 });
    const blocks = [
      plain,
      text("Inside", { parent_id: plain.id }),
      text("Between"),
      tinted,
      heading("Title", { parent_id: tinted.id, sort_order: 0 }),
      g,
      heading("Second heading", { parent_id: tinted.id, sort_order: 2 }),
      text("More", { parent_id: tinted.id, sort_order: 3 }),
      group("rose"), // empty: dropped
    ];
    const result = plan(blocks, [{ id: "p", block_id: g.id, sort_order: 1 }]);
    expect(
      result.sections.map(({ title, text, highlight }) => ({ title, text, highlight })),
    ).toEqual([
      { title: "", text: "Inside", highlight: 0 },
      { title: "", text: "Between", highlight: 0 },
      { title: "Title", text: "Second heading\n\nMore", highlight: 1 },
    ]);
    expect(result.photos.get("p")?.section_id).toBe(result.sections[2]?.id);
  });

  test("the migration converts an existing database", async () => {
    const sqlite = new SQLite(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    // biome-ignore lint/suspicious/noExplicitAny: the schema before this migration
    const db = new Kysely<any>({ dialect: new BunSqliteDialect(sqlite) });
    // better-auth's user table, which the domain tables reference.
    await db.schema
      .createTable("user")
      .addColumn("id", "text", (c) => c.primaryKey())
      .execute();
    await initial.up(db);
    await twoFactor.up(db);

    await db
      .insertInto("tenants")
      .values({ id: "t", name: "T", created_at: 1, timezone: "UTC" })
      .execute();
    const album = { tenant_id: "t", slug: "a", short_id: "x", created_at: 1, updated_at: 1 };
    await db
      .insertInto("albums")
      .values({ ...album, id: "a", title: "A" })
      .execute();
    const rows = [
      block({ type: "heading", content: '{"text":"Hi"}', album_id: "a" }),
      block({ type: "gallery", id: "g", album_id: "a" }),
    ];
    await db.insertInto("album_blocks").values(rows).execute();
    await db
      .insertInto("image_files")
      .values({
        id: "i",
        tenant_id: "t",
        content_hash: "h",
        filename: "f.bin",
        width: 4,
        height: 3,
        file_size: 1,
        placeholder: "",
        created_at: 1,
      })
      .execute();
    await db
      .insertInto("photos")
      .values({
        id: "p",
        tenant_id: "t",
        album_id: "a",
        block_id: "g",
        sort_order: 3,
        image_file_id: "i",
        uploaded_at: 1,
      })
      .execute();
    await db.updateTable("albums").set({ cover_photo_id: "p" }).execute();

    await sections.up(db);

    const [section] = await db.selectFrom("sections").selectAll().execute();
    expect(section).toMatchObject({ title: "Hi", text: "", highlight: 0, album_id: "a" });
    expect(await db.selectFrom("photos").selectAll().execute()).toEqual([
      expect.objectContaining({ id: "p", section_id: section?.id, sort_order: 1 }),
    ]);
    const tables = (await db.introspection.getTables()).map((t) => t.name);
    expect(tables).not.toContain("album_blocks");
    expect(tables).not.toContain("photos_new");

    // The cover trigger and the cascade from sections work on the new table.
    await db.deleteFrom("sections").execute();
    expect(await db.selectFrom("photos").selectAll().execute()).toEqual([]);
    expect(
      (await db.selectFrom("albums").select("cover_photo_id").executeTakeFirst())?.cover_photo_id,
    ).toBeNull();
    await db.destroy();
  });
});

describe("justified rows", () => {
  const opts = { width: 1000, targetHeight: 200, gap: 10 };

  test("rows fill the width; the last one keeps the target height", () => {
    const rows = justify([1.5, 1.5, 1.5, 1.5, 1.5, 1], opts);
    for (const row of rows.slice(0, -1)) {
      const width =
        row.items.reduce((sum, i) => sum + i.width, 0) + opts.gap * (row.items.length - 1);
      expect(width).toBeCloseTo(opts.width);
    }
    // Not stretched, and no taller than the row above.
    const last = rows.at(-1);
    expect(last?.height).toBe(Math.min(200, rows.at(-2)?.height ?? 200));
    expect(justify([1.5], opts)[0]?.height).toBe(200);
    expect(rows.flatMap((r) => r.items.map((i) => i.index))).toEqual([0, 1, 2, 3, 4, 5]);
    for (const row of rows) for (const item of row.items) expect(item.height).toBe(row.height);
  });

  test("keeps aspect ratios and handles odd input", () => {
    const rows = justify([2, 0.5, Number.NaN], opts);
    expect(rows.flatMap((r) => r.items.map((i) => i.width / i.height))).toEqual([2, 0.5, 1]);
    expect(justify([], opts)).toEqual([]);
    expect(justify([1], { ...opts, width: 0 })).toEqual([]);
  });

  test("closes a row where the height comes closer to the target", () => {
    // Squares at 1000px: four make a row ~242px high, five ~192px (closer to 200).
    const rows = justify([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], opts);
    expect(rows[0]?.items).toHaveLength(5);
    expect(rows[0]?.height).toBeCloseTo((1000 - 40) / 5);
  });
});
