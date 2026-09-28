import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Kysely, PostgresAdapter, sql } from "kysely";
import { config } from "../../config";

// Multi-tenancy: every domain row belongs to a tenant ("Sammelband" in the UI).
//
// Existing installations get one tenant that owns all current users and
// content; its oldest admin becomes the superadmin, and the photo files move
// to that tenant's directory. better-auth's migrator has already added
// user.tenantId and user.superadmin (additional fields in src/auth.ts).
//
// SQLite can't add a NOT NULL or foreign-key column to a table with rows, so
// tenant_id is nullable there (rows without a tenant are invisible to every
// tenant, so the failure mode is closed). image_files is rebuilt instead,
// because its UNIQUE(content_hash) has to become UNIQUE(tenant_id, content_hash).

const CONTENT_TABLES = ["folders", "albums", "album_blocks", "photos"] as const;

// biome-ignore lint/suspicious/noExplicitAny: migrations run against a changing schema
export async function up(db: Kysely<any>): Promise<void> {
  const postgres = db.getExecutor().adapter instanceof PostgresAdapter;
  // SQLite: no transactional DDL in Kysely's migrator, so run our own. Foreign
  // keys must be off to rebuild a referenced table, and that pragma can't
  // change inside a transaction.
  if (!postgres) {
    await sql`PRAGMA foreign_keys = OFF`.execute(db);
    await sql`BEGIN`.execute(db);
  }
  try {
    const tenantId = await migrate(db, postgres);
    if (!postgres) {
      const broken = await sql`PRAGMA foreign_key_check`.execute(db);
      if (broken.rows.length > 0) throw new Error("Foreign key check failed after migration");
    }
    // Before committing: if the move fails, the schema change rolls back too
    // (on Postgres the migrator's transaction is still open here).
    if (tenantId) moveFiles(tenantId);
    if (!postgres) await sql`COMMIT`.execute(db);
  } catch (err) {
    if (!postgres) await sql`ROLLBACK`.execute(db);
    throw err;
  } finally {
    if (!postgres) await sql`PRAGMA foreign_keys = ON`.execute(db);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: see up()
async function migrate(db: Kysely<any>, postgres: boolean): Promise<string | null> {
  await db.schema
    .createTable("tenants")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("name", "text", (c) => c.notNull())
    .addColumn("quota_bytes", "bigint")
    .addColumn("storage_used_bytes", "bigint", (c) => c.notNull().defaultTo(0))
    .addColumn("suspended_at", "bigint")
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .execute();

  await db.schema
    .createTable("tenant_invites")
    .ifNotExists()
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id").onDelete("cascade"))
    .addColumn("token_hash", "text", (c) => c.notNull().unique())
    .addColumn("role", "text", (c) => c.notNull())
    .addColumn("expires_at", "bigint", (c) => c.notNull())
    .addColumn("used_at", "bigint")
    .addColumn("created_at", "bigint", (c) => c.notNull())
    .execute();
  await db.schema
    .createIndex("idx_tenant_invites_tenant")
    .ifNotExists()
    .on("tenant_invites")
    .column("tenant_id")
    .execute();

  const tenantId = await adoptExistingData(db);

  for (const table of CONTENT_TABLES) {
    await db.schema
      .alterTable(table)
      .addColumn("tenant_id", "text", (c) => c.references("tenants.id"))
      .execute();
    if (tenantId) await db.updateTable(table).set({ tenant_id: tenantId }).execute();
  }
  await db.schema.createIndex("idx_folders_tenant").on("folders").column("tenant_id").execute();
  await db.schema.createIndex("idx_albums_tenant").on("albums").column("tenant_id").execute();

  if (postgres) {
    await db.schema
      .alterTable("image_files")
      .addColumn("tenant_id", "text", (c) => c.references("tenants.id"))
      .execute();
    if (tenantId) await db.updateTable("image_files").set({ tenant_id: tenantId }).execute();
    await db.schema
      .alterTable("image_files")
      .alterColumn("tenant_id", (c) => c.setNotNull())
      .execute();
    await db.schema
      .alterTable("image_files")
      .dropConstraint("image_files_content_hash_key")
      .execute();
    await db.schema
      .alterTable("image_files")
      .addUniqueConstraint("image_files_tenant_hash", ["tenant_id", "content_hash"])
      .execute();
    // Paths are derived from tenant + filename now.
    await db.schema.alterTable("image_files").dropColumn("original_path").execute();
  } else {
    await db.schema
      .createTable("image_files_new")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("tenant_id", "text", (c) => c.notNull().references("tenants.id"))
      .addColumn("content_hash", "text", (c) => c.notNull())
      .addColumn("filename", "text", (c) => c.notNull())
      .addColumn("width", "integer", (c) => c.notNull())
      .addColumn("height", "integer", (c) => c.notNull())
      .addColumn("file_size", "bigint", (c) => c.notNull())
      .addColumn("placeholder", "text", (c) => c.notNull())
      .addColumn("created_at", "bigint", (c) => c.notNull())
      .addUniqueConstraint("image_files_tenant_hash", ["tenant_id", "content_hash"])
      .execute();
    if (tenantId) {
      await db
        .insertInto("image_files_new")
        .columns([
          "id",
          "tenant_id",
          "content_hash",
          "filename",
          "width",
          "height",
          "file_size",
          "placeholder",
          "created_at",
        ])
        .expression((eb) =>
          eb
            .selectFrom("image_files")
            .select([
              "id",
              eb.val(tenantId).as("tenant_id"),
              "content_hash",
              "filename",
              "width",
              "height",
              "file_size",
              "placeholder",
              "created_at",
            ]),
        )
        .execute();
    }
    await db.schema.dropTable("image_files").execute();
    await db.schema.alterTable("image_files_new").renameTo("image_files").execute();
  }
  return tenantId;
}

/** Put the users and content of a pre-tenant installation into one tenant. */
// biome-ignore lint/suspicious/noExplicitAny: see up()
async function adoptExistingData(db: Kysely<any>): Promise<string | null> {
  const anyUser = await db.selectFrom("user").select("id").limit(1).executeTakeFirst();
  const anyFolder = await db.selectFrom("folders").select("id").limit(1).executeTakeFirst();
  const anyAlbum = await db.selectFrom("albums").select("id").limit(1).executeTakeFirst();
  if (!anyUser && !anyFolder && !anyAlbum) return null;

  const tenantId = Bun.randomUUIDv7();
  const { used } = await db
    .selectFrom("image_files")
    .select((eb) => eb.fn.coalesce(eb.fn.sum("file_size"), eb.lit(0)).as("used"))
    .executeTakeFirstOrThrow();
  await db
    .insertInto("tenants")
    .values({
      id: tenantId,
      name: "Sammelband",
      quota_bytes: null,
      storage_used_bytes: Number(used),
      suspended_at: null,
      created_at: Date.now(),
    })
    .execute();
  await db.updateTable("user").set({ tenantId }).execute();
  const owner = await db
    .selectFrom("user")
    .select("id")
    .where("role", "=", "admin")
    .orderBy("createdAt")
    .limit(1)
    .executeTakeFirst();
  if (owner) {
    await db.updateTable("user").set({ superadmin: true }).where("id", "=", owner.id).execute();
  }
  return tenantId;
}

/** uploads/originals → uploads/tenants/<id>/originals; the variant cache is rebuilt on demand. */
function moveFiles(tenantId: string): void {
  const from = join(config.UPLOADS_PATH, "originals");
  const to = join(config.UPLOADS_PATH, "tenants", tenantId, "originals");
  if (existsSync(from)) {
    mkdirSync(join(config.UPLOADS_PATH, "tenants", tenantId), { recursive: true });
    renameSync(from, to);
  }
  rmSync(join(config.UPLOADS_PATH, "variants"), { recursive: true, force: true });
}
