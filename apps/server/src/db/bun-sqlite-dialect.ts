import type { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
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
    return new BunSqliteAdapter();
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

/**
 * Kysely (0.29+) queues connections itself for single-connection adapters,
 * before the driver is asked. A root query inside a transaction would then
 * wait in that queue forever, and the driver's guard below never sees it. The
 * driver serializes the connection on its own, so Kysely's queue is off here.
 */
class BunSqliteAdapter extends SqliteAdapter {
  override get supportsMultipleConnections(): boolean {
    return true;
  }
}

/**
 * Marks the async context (one request) that holds the connection in a
 * transaction. A query on the root `db` from inside the transaction callback
 * would queue behind the transaction it is part of and wait forever, stalling
 * every request; with the marker it fails right away instead.
 */
const transactionGuard = new AsyncLocalStorage<{ inTransaction: boolean }>();

/** Run `fn` with its own transaction marker (runInTenant does this per request). */
export function withTransactionGuard<T>(fn: () => T): T {
  return transactionGuard.run({ inTransaction: false }, fn);
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
    if (transactionGuard.getStore()?.inTransaction) {
      throw new Error(
        "Query on the root db inside a transaction: use the transaction's trx handle " +
          "(SQLite has one connection, so this would wait forever)",
      );
    }
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
    setInTransaction(true);
  }
  async commitTransaction(connection: DatabaseConnection) {
    setInTransaction(false);
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }
  async rollbackTransaction(connection: DatabaseConnection) {
    setInTransaction(false);
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

function setInTransaction(value: boolean): void {
  const marker = transactionGuard.getStore();
  if (marker) marker.inTransaction = value;
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
