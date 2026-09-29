import { getMigrations } from "better-auth/db/migration";
import { sql } from "kysely";
import { Migrator } from "kysely/migration";
import { auth } from "../auth";
import { db, dbType } from "./client";
import { migrations } from "./migrations";

/**
 * Bring the database up to date. Runs on every start, so updating means
 * pulling a new version and restarting.
 *
 * better-auth goes first: its migrator creates or extends its own tables
 * (user, session, account, verification, plus plugin tables) from the auth
 * config. The domain migrations reference `user`, so they run after it.
 *
 * On Postgres, several instances may start at once: an advisory lock makes
 * them migrate one after another (Kysely locks its own migrations, but not
 * better-auth's). SQLite has a single connection, which already serializes.
 */
export async function migrate(): Promise<void> {
  if (dbType !== "postgres") return runMigrations();
  await db.connection().execute(async (conn) => {
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK})`.execute(conn);
    try {
      await runMigrations();
    } finally {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK})`.execute(conn);
    }
  });
}

/** Arbitrary constant identifying Sammelband's migration lock. */
const MIGRATION_LOCK = 7_261_553_901;

async function runMigrations(): Promise<void> {
  const authMigrations = await getMigrations(auth.options);
  await authMigrations.runMigrations();

  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === "Success") console.log(`[db] applied migration ${r.migrationName}`);
    if (r.status === "Error") console.error(`[db] migration ${r.migrationName} failed`);
  }
  if (error) throw error;
}
