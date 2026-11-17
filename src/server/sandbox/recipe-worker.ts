/**
 * Worker entry: interprets one recipe with the trusted evaluator. It receives
 * file text, never paths or handles, and returns proposed outputs; the broker
 * decides what is committed. Bundled to .forge-build/recipe-worker.mjs.
 */
import { parentPort } from "node:worker_threads";
import { profileTable, schemaOf } from "../../core/profile";
import { compileRecipe, runPlan } from "../../core/recipe/engine";
import type { Recipe } from "../../core/recipe/schema";
import { loadInputs } from "../../core/synth/crucible";
import type { Format } from "../../core/codec";

export type WorkerJob = {
  id: number;
  recipe: Recipe;
  files: { slot: string; name: string; format: Format; text: string }[];
  now: string;
  instrument: boolean;
  workLimit: number;
};
export type WorkerOutput = {
  kind: "file" | "view";
  name: string;
  format: string;
  text: string;
  bytes: number;
  rows: number;
  columns: string[];
  preview: Record<string, unknown>[];
  view?: unknown;
};
export type WorkerReply =
  | { id: number; ok: true; outputs: WorkerOutput[]; work: number; ms: number; snapshots?: unknown[]; offsets?: Record<string, number> }
  | { id: number; ok: false; error: string; code?: string };

parentPort?.on("message", (job: WorkerJob) => {
  try {
    const inputs = loadInputs(job.recipe, job.files);
    const schemas = Object.fromEntries(Object.entries(inputs).map(([k, t]) => [k, schemaOf(profileTable(t))]));
    const plan = compileRecipe(job.recipe, schemas, { now: job.now });
    const result = runPlan(plan, inputs, { instrument: job.instrument, now: job.now, workLimit: job.workLimit });
    const outputs: WorkerOutput[] = result.outputs.map((o) =>
      o.kind === "file"
        ? { kind: "file", name: o.name, format: o.format, text: o.text, bytes: o.bytes, rows: o.table.rows.length, columns: o.table.columns, preview: o.table.rows.slice(0, 50) }
        : { kind: "view", name: o.output.title ?? `${o.output.type} chart`, format: "view", text: "", bytes: 0, rows: o.table.rows.length, columns: o.table.columns, preview: o.table.rows.slice(0, 500), view: o.output },
    );
    const reply: WorkerReply = { id: job.id, ok: true, outputs, work: result.work, ms: result.ms, snapshots: result.snapshots, offsets: result.offsets };
    parentPort!.postMessage(reply);
  } catch (error) {
    const reply: WorkerReply = { id: job.id, ok: false, error: error instanceof Error ? error.message : String(error), code: (error as { code?: string }).code };
    parentPort!.postMessage(reply);
  }
});
