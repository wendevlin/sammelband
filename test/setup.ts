import { afterAll, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs before any test file, so config sees these. SQLite in memory by default;
// set DATABASE_URL=postgres://… to run the suite against Postgres (its tables
// are emptied before every test, so use a throwaway database).
const uploads = mkdtempSync(join(tmpdir(), "sammelband-test-"));
process.env.UPLOADS_PATH = uploads;
process.env.NODE_ENV = "test";
if (!process.env.DATABASE_URL) process.env.DATABASE_PATH = ":memory:";

const { migrate } = await import("../src/db/migrate");
const { resetDatabase } = await import("./helpers");
await migrate();

beforeEach(resetDatabase);
afterAll(() => rmSync(uploads, { recursive: true, force: true }));
