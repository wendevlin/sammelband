import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Runs at most `limit` tasks at once; the others wait in the order they came.
 * A task must not wait for another slot of the same semaphore (with every slot
 * taken it would wait for itself, so `run` refuses that), and should hold its
 * slot only for the work being limited, not while waiting for something else
 * that can be busy, such as the database.
 */
export class Semaphore {
  #active = 0;
  readonly #queue: (() => void)[] = [];
  /** Set inside this semaphore's tasks, to catch a nested `run`. */
  readonly #inside = new AsyncLocalStorage<true>();

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("A semaphore needs a limit of at least 1");
    }
  }

  /** Tasks running or waiting. */
  get pending(): number {
    return this.#active + this.#queue.length;
  }

  async run<T>(task: () => T | Promise<T>): Promise<T> {
    if (this.#inside.getStore()) {
      throw new Error("Semaphore.run inside one of its own tasks could deadlock");
    }
    if (this.#active < this.limit) this.#active++;
    else await new Promise<void>((resolve) => this.#queue.push(resolve));
    try {
      return await this.#inside.run(true, task);
    } finally {
      // The slot goes straight to the next task, so no newcomer can jump the queue.
      const next = this.#queue.shift();
      if (next) next();
      else this.#active--;
    }
  }
}

/**
 * Image decoding. A 100-megapixel photo needs about 400 MB while it is decoded,
 * and uploads, new image sizes (also for visitors of public links), avatars and
 * PDF exports all decode: two at a time bound the memory.
 */
export const imageDecoding = new Semaphore(2);
