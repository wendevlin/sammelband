// A queue of background jobs, run one at a time in this process. For work
// that takes long and shouldn't run in parallel on a small server (PDF
// exports). Jobs are recorded in the database by their callers, which re-queue
// unfinished ones at startup; this queue only holds what to run next.

export type JobQueue<T> = {
  enqueue(job: T): void;
  /** Resolves when every queued job has run (tests). */
  idle(): Promise<void>;
};

export function createJobQueue<T>(name: string, run: (job: T) => Promise<void>): JobQueue<T> {
  const jobs: T[] = [];
  let running: Promise<void> | null = null;

  const drain = async () => {
    for (let job = jobs.shift(); job !== undefined; job = jobs.shift()) {
      try {
        await run(job);
      } catch (err) {
        console.error(`[${name}] job failed`, err);
      }
    }
    running = null;
  };

  return {
    enqueue(job) {
      jobs.push(job);
      running ??= drain();
    },
    async idle() {
      while (running) await running;
    },
  };
}
