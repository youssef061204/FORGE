/**
 * A small pool of recipe workers. Each job has a memory ceiling (V8 heap
 * limits on the worker) and a wall-clock kill: a worker that overruns is
 * terminated and replaced, and the job fails with a plain reason.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { WorkerJob, WorkerReply } from "./recipe-worker";

export const SANDBOX_LIMITS = { maxMs: 5_000, heapMb: 512, workLimit: 20_000_000 };

export function workerPath(): string {
  const p = join(process.cwd(), ".forge-build", "recipe-worker.mjs");
  if (!existsSync(p)) throw new Error("The recipe worker is not built. Run `npm run build:worker` (npm run forge does this for you).");
  return p;
}

type Slot = { worker: Worker; busy: boolean };

export class SandboxPool {
  private slots: Slot[] = [];
  private queue: { job: Omit<WorkerJob, "id">; maxMs: number; resolve: (r: WorkerReply) => void }[] = [];
  private seq = 0;
  constructor(private readonly size = 2) {}

  private spawn(): Slot {
    const worker = new Worker(workerPath(), {
      resourceLimits: { maxOldGenerationSizeMb: SANDBOX_LIMITS.heapMb, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 },
      // No environment, no stdin: the worker has nothing to read.
      env: {},
      stdin: false,
    });
    worker.unref();
    const slot = { worker, busy: false };
    this.slots.push(slot);
    return slot;
  }

  run(job: Omit<WorkerJob, "id" | "workLimit"> & { workLimit?: number }, maxMs = SANDBOX_LIMITS.maxMs): Promise<WorkerReply> {
    return new Promise((resolve) => {
      this.queue.push({ job: { ...job, workLimit: job.workLimit ?? SANDBOX_LIMITS.workLimit }, maxMs, resolve });
      this.pump();
    });
  }

  private pump() {
    while (this.queue.length) {
      let slot = this.slots.find((s) => !s.busy);
      if (!slot && this.slots.length < this.size) slot = this.spawn();
      if (!slot) return;
      const { job, maxMs, resolve } = this.queue.shift()!;
      const id = ++this.seq;
      slot.busy = true;
      const s = slot;
      let settled = false;
      const finish = (reply: WorkerReply) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        s.worker.off("message", onMessage);
        s.worker.off("error", onError);
        s.busy = false;
        resolve(reply);
        this.pump();
      };
      const replace = () => {
        this.slots = this.slots.filter((x) => x !== s);
        void s.worker.terminate();
      };
      const onMessage = (reply: WorkerReply) => {
        if (reply.id === id) finish(reply);
      };
      const onError = (error: Error) => {
        replace();
        finish({ id, ok: false, error: /heap|memory/i.test(error.message) ? "the tool ran out of its memory allowance" : error.message, code: "WORKER_CRASH" });
      };
      const timer = setTimeout(() => {
        replace();
        finish({ id, ok: false, error: `the tool ran longer than ${Math.round(maxMs / 1000)} seconds and was stopped`, code: "TIMEOUT" });
      }, maxMs);
      s.worker.on("message", onMessage);
      s.worker.once("error", onError);
      s.worker.postMessage({ ...job, id });
    }
  }

  async close() {
    await Promise.all(this.slots.map((s) => s.worker.terminate()));
    this.slots = [];
  }
}
