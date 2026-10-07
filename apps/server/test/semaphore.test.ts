import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { Semaphore } from "../src/lib/semaphore";

/** A promise to resolve from outside. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

/** Let every pending promise callback run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("semaphore", () => {
  test("runs at most `limit` tasks at once", async () => {
    const semaphore = new Semaphore(2);
    const gates = Array.from({ length: 6 }, gate);
    let running = 0;
    let most = 0;
    const done = gates.map((g, i) =>
      semaphore.run(async () => {
        running++;
        most = Math.max(most, running);
        await g.opened;
        running--;
        return i;
      }),
    );
    await settle();
    expect(running).toBe(2);
    expect(semaphore.pending).toBe(6);
    for (const g of gates) {
      g.open();
      await settle();
      expect(running).toBeLessThanOrEqual(2);
    }
    expect(await Promise.all(done)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(most).toBe(2);
    expect(semaphore.pending).toBe(0);
  });

  test("a task that throws gives its slot back", async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(() => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    await expect(semaphore.run(() => Promise.reject(new Error("async")))).rejects.toThrow("async");
    expect(semaphore.pending).toBe(0);
    expect(await semaphore.run(() => "still works")).toBe("still works");
  });

  test("waiting tasks start in the order they came", async () => {
    const semaphore = new Semaphore(1);
    const started: string[] = [];
    const [first, second] = [gate(), gate()];
    const task = (name: string, wait?: Promise<void>) =>
      semaphore.run(async () => {
        started.push(name);
        await wait;
      });
    const all = [task("a", first.opened), task("b", second.opened), task("c"), task("d")];
    await settle();
    expect(started).toEqual(["a"]);
    first.open();
    await settle();
    expect(started).toEqual(["a", "b"]);
    // Comes later than "c" and "d", so it starts after them.
    all.push(task("e"));
    second.open();
    await Promise.all(all);
    expect(started).toEqual(["a", "b", "c", "d", "e"]);
  });

  test("a task keeps its async context while it waits", async () => {
    const semaphore = new Semaphore(1);
    const context = new AsyncLocalStorage<string>();
    const blocker = gate();
    const blocked = semaphore.run(() => blocker.opened);
    const seen = Promise.all(
      ["x", "y"].map((name) => context.run(name, () => semaphore.run(() => context.getStore()))),
    );
    blocker.open();
    await blocked;
    expect(await seen).toEqual(["x", "y"]);
  });

  test("refuses to wait for itself instead of deadlocking", async () => {
    const semaphore = new Semaphore(1);
    await expect(semaphore.run(() => semaphore.run(() => "inner"))).rejects.toThrow("deadlock");
    expect(semaphore.pending).toBe(0);
  });
});
