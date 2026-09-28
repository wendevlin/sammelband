import { getMigrations } from "better-auth/db/migration";
import { Migrator } from "kysely";
import { auth } from "../auth";
import { db } from "./client";
import { migrations } from "./migrations";

/**
 * Bring the database up to date. Runs on every start, so updating means
 * pulling a new version and restarting.
 *
 * better-auth goes first: its migrator creates or extends its own tables
 * (user, session, account, verification, plus plugin tables) from the auth
 * config. The domain migrations reference `user`, so they run after it.
 */
export async function migrate(): Promise<void> {
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
