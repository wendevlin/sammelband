import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";

export const db = new Database(config.DATABASE_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

/** Apply db/schema.sql. Every statement is IF NOT EXISTS, so this is idempotent. */
export function initSchema(): void {
  const sql = readFileSync(join(import.meta.dir, "../../db/schema.sql"), "utf8");
  db.exec(sql);
}
