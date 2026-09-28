import { describe, expect, test } from "bun:test";
import { db } from "../src/db/client";
import { TenantScopePlugin } from "../src/db/tenant-scope";
import { tdb } from "../src/lib/tenant-context";
import { inTenant } from "./helpers";

const scoped = db.withPlugin(new TenantScopePlugin("T1"));

describe("TenantScopePlugin", () => {
  test("filters the target table of select, update and delete", () => {
    const select = scoped.selectFrom("albums").selectAll().where("id", "=", "a").compile();
    expect(select.sql).toMatch(/"albums"\."tenant_id" = \?|"albums"\."tenant_id" = \$\d/);
    expect(select.parameters).toContain("T1");

    const update = scoped.updateTable("folders").set({ name: "x" }).compile();
    expect(update.sql).toMatch(/"folders"\."tenant_id" = /);
    expect(update.parameters).toContain("T1");

    const del = scoped.deleteFrom("photos").where("id", "=", "p").compile();
    expect(del.sql).toMatch(/"photos"\."tenant_id" = /);
  });

  test("uses aliases, filters joins in ON and reaches subqueries", () => {
    const q = scoped
      .selectFrom("photos as p")
      .innerJoin("image_files as i", "i.id", "p.image_file_id")
      .select("i.filename")
      .where("p.album_id", "in", (eb) => eb.selectFrom("albums").select("id"))
      .compile();
    expect(q.sql).toMatch(/"p"\."tenant_id" = /);
    expect(q.sql).toMatch(/on .*"i"\."tenant_id" = /i);
    expect(q.sql).toMatch(/from "albums" where "albums"\."tenant_id" = /);
    expect(q.parameters.filter((p) => p === "T1")).toHaveLength(3);
  });

  test("keeps OR conditions grouped", () => {
    const q = scoped
      .selectFrom("albums")
      .select("id")
      .where((eb) => eb.or([eb("id", "=", "a"), eb("id", "=", "b")]))
      .compile();
    expect(q.sql).toMatch(/where \(.*or.*\) and "albums"\."tenant_id" = /);
  });

  test("uses the better-auth column name for users", () => {
    const q = scoped.selectFrom("user").select("id").compile();
    expect(q.sql).toMatch(/"user"\."tenantId" = /);
  });

  test("leaves other tables alone", () => {
    const q = scoped.selectFrom("tenants").selectAll().compile();
    expect(q.parameters).toEqual([]);
  });

  test("inserts must target the scoped tenant", () => {
    const row = { id: "f", name: "F", parent_id: null, created_by: null, created_at: 1 };
    expect(() =>
      scoped
        .insertInto("folders")
        .values({ ...row, tenant_id: "T1" })
        .compile(),
    ).not.toThrow();
    expect(() =>
      scoped
        .insertInto("folders")
        .values({ ...row, tenant_id: "T2" })
        .compile(),
    ).toThrow("another tenant");
    expect(() =>
      scoped
        .insertInto("folders")
        // biome-ignore lint/suspicious/noExplicitAny: deliberately missing tenant_id
        .values(row as any)
        .compile(),
    ).toThrow("must set tenant_id");
  });
});

describe("SQLite transaction guard", () => {
  // Postgres has a pool, so a stray root query there doesn't deadlock.
  test.skipIf(!!process.env.DATABASE_URL)(
    "a root db query inside a transaction fails instead of hanging",
    inTenant(async () => {
      await expect(
        tdb()
          .transaction()
          .execute(async () => {
            await tdb().selectFrom("albums").select("id").execute();
          }),
      ).rejects.toThrow("use the transaction's trx handle");
      // The connection is free again afterwards.
      expect(await tdb().selectFrom("albums").select("id").execute()).toEqual([]);
    }),
  );
});
