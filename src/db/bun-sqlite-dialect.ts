import type { Database } from "bun:sqlite";
import {
  CompiledQuery,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";

/**
 * Kysely dialect for bun:sqlite. Kysely's own SqliteDialect expects the
 * better-sqlite3 API (`stmt.reader`), which bun:sqlite doesn't have, so only the
 * driver is custom; adapter, compiler and introspector are Kysely's.
 */
export class BunSqliteDialect implements Dialect {
  constructor(private readonly database: Database) {}

  createAdapter() {
    return new SqliteAdapter();
  }
  createDriver(): Driver {
    return new BunSqliteDriver(this.database);
  }
  createQueryCompiler() {
    return new SqliteQueryCompiler();
  }
  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}

// SQLite has a single connection; queries and transactions take turns on it.
class BunSqliteDriver implements Driver {
  readonly #connection: BunSqliteConnection;
  #queue: Promise<void> = Promise.resolve();
  #release: (() => void) | null = null;

  constructor(private readonly database: Database) {
    this.#connection = new BunSqliteConnection(database);
  }

  async init() {}

  async acquireConnection(): Promise<DatabaseConnection> {
    const previous = this.#queue;
    let release!: () => void;
    this.#queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    this.#release = release;
    return this.#connection;
  }

  async beginTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("begin"));
  }
  async commitTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }
  async rollbackTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }

  async releaseConnection() {
    const release = this.#release;
    this.#release = null;
    release?.();
  }

  async destroy() {
    this.database.close();
  }
}

class BunSqliteConnection implements DatabaseConnection {
  constructor(private readonly database: Database) {}

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const stmt = this.database.prepare(query.sql);
    const params = query.parameters as never[];
    // Statements that return rows (SELECT, RETURNING, PRAGMA) have result columns.
    if (stmt.columnNames.length > 0) return { rows: stmt.all(...params) as R[] };
    const { changes, lastInsertRowid } = stmt.run(...params);
    return {
      rows: [],
      numAffectedRows: BigInt(changes),
      insertId: BigInt(lastInsertRowid),
    };
  }

  // biome-ignore lint/correctness/useYield: streaming is unsupported
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("bun:sqlite does not support streaming queries");
  }
}
