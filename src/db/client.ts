import { Database as SQLite } from "bun:sqlite";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { config } from "../config";
import { BunSqliteDialect } from "./bun-sqlite-dialect";
import type { Database } from "./schema";

export type DatabaseType = "sqlite" | "postgres";

/**
 * Which database to use, from config. Adding a provider (e.g. Turso/libSQL)
 * means one more case here and in createDialect(); queries and migrations are
 * dialect-agnostic.
 */
export function databaseType(url = config.DATABASE_URL): DatabaseType {
  if (!url) return "sqlite";
  if (/^postgres(ql)?:\/\//.test(url)) return "postgres";
  throw new Error(`Unsupported DATABASE_URL: ${url.split(":")[0]}://… (use postgres://)`);
}

export const dbType = databaseType();

function createDialect() {
  if (dbType === "postgres") {
    // bigint (epoch-ms timestamps, file sizes) arrives as a string by default.
    pg.types.setTypeParser(pg.types.builtins.INT8, Number);
    return new PostgresDialect({ pool: new pg.Pool({ connectionString: config.DATABASE_URL }) });
  }
  const sqlite = new SQLite(config.DATABASE_PATH, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("PRAGMA busy_timeout = 5000");
  return new BunSqliteDialect(sqlite);
}

export const db = new Kysely<Database>({ dialect: createDialect() });

/** A transaction handle or the root db: services accept either. */
export type Executor = Kysely<Database>;
