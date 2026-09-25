import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";

export const db = new Database(config.DATABASE_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    filename   TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`);

export function runMigrations(): void {
  const applied = new Set(
    (db.query("SELECT filename FROM _migrations").all() as { filename: string }[]).map(
      (r) => r.filename,
    ),
  );

  const migrationsDir = join(import.meta.dir, "../../db/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.run("INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)", [file, Date.now()]);
    })();
    console.log(`[migrations] applied ${file}`);
  }
}
