import { type Kysely, PostgresAdapter, sql, type Transaction } from "kysely";

// Sections replace blocks. An album is a list of sections, each with a title,
// Markdown text, a highlight flag and the photos pointing at it. Existing
// blocks are converted (see planSections), photos move from `block_id` to
// `section_id`, and `album_blocks` is dropped. Lossy on purpose: heading
// levels, group colors and the order of text vs. gallery inside a group go.

export type OldBlock = {
  id: string;
  tenant_id: string;
  album_id: string;
  parent_id: string | null;
  sort_order: number;
  type: string;
  content: string;
  created_at: number;
  updated_at: number;
};

export type OldPhoto = { id: string; block_id: string; sort_order: number };

export type NewSection = {
  id: string;
  tenant_id: string;
  album_id: string;
  sort_order: number;
  title: string;
  text: string;
  highlight: number;
  created_at: number;
  updated_at: number;
};

type Draft = {
  blocks: OldBlock[];
  title: string;
  texts: string[];
  galleries: string[];
  highlight: boolean;
  hasPhotos: boolean;
};

function parse(block: OldBlock): Record<string, unknown> {
  try {
    const value = JSON.parse(block.content);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * Turn blocks into sections. A group becomes one section (highlighted unless
 * its background was "none"): its first heading is the title, texts and
 * further headings are joined as paragraphs, galleries merged. Ungrouped
 * top-level blocks are split into sections at each heading, and where text
 * follows photos (so text stays above the photos it came before). Sections
 * without title, text or photos are dropped. Returns the sections and, per
 * photo, its section and position in the merged gallery.
 */
export function planSections(
  blocks: OldBlock[],
  photos: OldPhoto[],
  newId: () => string,
): { sections: NewSection[]; photos: Map<string, { section_id: string; sort_order: number }> } {
  const bySort = (a: { sort_order: number }, b: { sort_order: number }) =>
    a.sort_order - b.sort_order;
  const photosOf = new Map<string, OldPhoto[]>();
  for (const p of [...photos].sort(bySort)) {
    const list = photosOf.get(p.block_id) ?? [];
    list.push(p);
    photosOf.set(p.block_id, list);
  }
  const byAlbum = new Map<string, OldBlock[]>();
  for (const b of blocks) {
    const list = byAlbum.get(b.album_id) ?? [];
    list.push(b);
    byAlbum.set(b.album_id, list);
  }

  const sections: NewSection[] = [];
  const photoMoves = new Map<string, { section_id: string; sort_order: number }>();

  for (const [albumId, albumBlocks] of byAlbum) {
    const drafts: Draft[] = [];
    const fresh = (highlight = false): Draft => ({
      blocks: [],
      title: "",
      texts: [],
      galleries: [],
      highlight,
      hasPhotos: false,
    });
    const empty = (d: Draft) => !d.title && d.texts.length === 0 && d.galleries.length === 0;
    /** Add a block to a draft; returns false when it belongs in a new one. */
    const add = (d: Draft, b: OldBlock, splitting: boolean): boolean => {
      const c = parse(b);
      if (b.type === "heading") {
        const text = str(c.text);
        if (!text) return true;
        if (!d.title && (!splitting || empty(d))) d.title = text;
        else if (splitting) return false;
        else d.texts.push(text);
      } else if (b.type === "text") {
        const text = str(c.markdown);
        if (!text) return true;
        if (splitting && d.hasPhotos) return false;
        d.texts.push(text);
      } else if (b.type === "gallery") {
        d.galleries.push(b.id);
        if (photosOf.get(b.id)?.length) d.hasPhotos = true;
      }
      d.blocks.push(b);
      return true;
    };

    let run: Draft | null = null;
    const topLevel = albumBlocks.filter((b) => !b.parent_id).sort(bySort);
    for (const b of topLevel) {
      if (b.type === "group") {
        if (run) drafts.push(run);
        run = null;
        const background = str(parse(b).background);
        const group = fresh(background !== "" && background !== "none");
        group.blocks.push(b);
        for (const child of albumBlocks.filter((x) => x.parent_id === b.id).sort(bySort)) {
          add(group, child, false);
        }
        drafts.push(group);
        continue;
      }
      run ??= fresh();
      if (!add(run, b, true)) {
        drafts.push(run);
        run = fresh();
        add(run, b, true);
      }
    }
    if (run) drafts.push(run);

    let order = 0;
    for (const d of drafts) {
      if (empty(d) || (!d.title && d.texts.length === 0 && !d.hasPhotos)) continue;
      const first = d.blocks[0];
      if (!first) continue;
      const id = newId();
      sections.push({
        id,
        tenant_id: first.tenant_id,
        album_id: albumId,
        sort_order: ++order,
        title: d.title,
        text: d.texts.join("\n\n"),
        highlight: d.highlight ? 1 : 0,
        created_at: Math.min(...d.blocks.map((x) => x.created_at)),
        updated_at: Math.max(...d.blocks.map((x) => x.updated_at)),
      });
      let n = 0;
      for (const g of d.galleries) {
        for (const p of photosOf.get(g) ?? []) {
          photoMoves.set(p.id, { section_id: id, sort_order: ++n });
        }
      }
    }
  }
  return { sections, photos: photoMoves };
}

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
async function convert(trx: Kysely<any> | Transaction<any>, postgres: boolean): Promise<void> {
  await trx.schema
    .createTable("sections")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("album_id", "text", (c) => c.notNull().references("albums.id").onDelete("cascade"))
    .addColumn("sort_order", "double precision", (c) => c.notNull())
    .addColumn("title", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("text", "text", (c) => c.notNull().defaultTo(""))
    .addColumn("highlight", "integer", (c) => c.notNull().defaultTo(0))
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .addColumn("updated_at", "bigint", (c) => c.notNull())
    .execute();
  await trx.schema
    .createIndex("idx_sections_album")
    .on("sections")
    .columns(["album_id", "sort_order"])
    .execute();
  await trx.schema.createIndex("idx_sections_tenant").on("sections").column("tenant_id").execute();

  const rows = (await trx.selectFrom("album_blocks").selectAll().execute()) as OldBlock[];
  const blocks = rows.map((b) => ({
    ...b,
    sort_order: Number(b.sort_order),
    created_at: Number(b.created_at),
    updated_at: Number(b.updated_at),
  }));
  const oldPhotos = await trx.selectFrom("photos").selectAll().execute();
  const plan = planSections(
    blocks,
    oldPhotos.map((p) => ({ id: p.id, block_id: p.block_id, sort_order: Number(p.sort_order) })),
    () => Bun.randomUUIDv7(),
  );
  for (const s of plan.sections) await trx.insertInto("sections").values(s).execute();

  // Photos get section_id instead of block_id: rebuilt, since SQLite can't
  // change a column's foreign key in place.
  await trx.schema
    .createTable("photos_new")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
    .addColumn("album_id", "text", (c) => c.notNull().references("albums.id").onDelete("cascade"))
    .addColumn("section_id", "text", (c) =>
      c.notNull().references("sections.id").onDelete("cascade"),
    )
    .addColumn("sort_order", "double precision", (c) => c.notNull())
    .addColumn("image_file_id", "text", (c) => c.notNull().references("image_files.id"))
    .addColumn("caption", "text")
    .addColumn("uploaded_by", "text", (c) => c.references("user.id").onDelete("set null"))
    .addColumn("uploaded_at", "bigint", (c) => c.notNull())
    .execute();
  for (const p of oldPhotos) {
    const moved = plan.photos.get(p.id);
    // Every photo sits in a gallery, and every gallery with photos becomes part of a section.
    if (!moved) throw new Error(`photo ${p.id} has no section`);
    const { block_id: _, ...rest } = p;
    await trx
      .insertInto("photos_new")
      .values({ ...rest, ...moved })
      .execute();
  }
  await trx.schema.dropTable("photos").execute();
  await trx.schema.alterTable("photos_new").renameTo("photos").execute();
  await trx.schema.createIndex("idx_photos_album").on("photos").column("album_id").execute();
  await trx.schema
    .createIndex("idx_photos_section")
    .on("photos")
    .columns(["section_id", "sort_order"])
    .execute();
  await trx.schema.createIndex("idx_photos_imgfile").on("photos").column("image_file_id").execute();
  await trx.schema.createIndex("idx_photos_tenant").on("photos").column("tenant_id").execute();

  // The trigger went with the old table (the Postgres function stays).
  if (postgres) {
    await sql`
      CREATE TRIGGER trg_photos_clear_cover
      AFTER DELETE ON photos
      FOR EACH ROW EXECUTE FUNCTION photos_clear_cover()`.execute(trx);
  } else {
    await sql`
      CREATE TRIGGER trg_photos_clear_cover
      AFTER DELETE ON photos
      BEGIN
        UPDATE albums SET cover_photo_id = NULL WHERE cover_photo_id = OLD.id;
      END`.execute(trx);
  }

  await trx.schema.dropTable("album_blocks").execute();
}

// biome-ignore lint/suspicious/noExplicitAny: see convert()
export async function up(db: Kysely<any>): Promise<void> {
  const adapter = db.getExecutor().adapter;
  // Postgres migrations already run in a transaction; SQLite ones don't.
  if (adapter.supportsTransactionalDdl) return convert(db, adapter instanceof PostgresAdapter);
  await db.transaction().execute((trx) => convert(trx, false));
}

export async function down(): Promise<void> {
  throw new Error("0003_sections can't be undone: blocks were converted into sections");
}
