/// <reference lib="webworker" />
/**
 * Runs a recipe in the visitor's browser with the same core engine the server
 * uses. Files stay in this tab; nothing is sent anywhere (CSP connect-src 'self').
 */
import { profileTable, schemaOf } from "@/core/profile";
import { compileRecipe, runPlan } from "@/core/recipe/engine";
import type { Recipe } from "@/core/recipe/schema";
import { loadInputs } from "@/core/synth/crucible";
import type { Format } from "@/core/codec";

type Job = { id: number; recipe: Recipe; files: { slot: string; name: string; format: Format; text: string }[]; instrument: boolean; now: string };

self.onmessage = (m: MessageEvent<Job>) => {
  const job = m.data;
  try {
    const inputs = loadInputs(job.recipe, job.files);
    const plan = compileRecipe(job.recipe, Object.fromEntries(Object.entries(inputs).map(([k, t]) => [k, schemaOf(profileTable(t))])), { now: job.now });
    const r = runPlan(plan, inputs, { instrument: job.instrument, now: job.now });
    (self as unknown as Worker).postMessage({
      id: job.id,
      ok: true,
      ms: r.ms,
      offsets: r.offsets,
      snapshots: r.snapshots,
      inputs: Object.fromEntries(Object.entries(inputs).map(([k, t]) => [k, { columns: t.columns, rows: t.rows.slice(0, 300), total: t.rows.length }])),
      outputs: r.outputs.map((o) =>
        o.kind === "file"
          ? { kind: "file", name: o.name, format: o.format, text: o.text, bytes: o.bytes, table: { columns: o.table.columns, rows: o.table.rows.slice(0, 300), total: o.table.rows.length, lineage: o.table.lin?.slice(0, 300) } }
          : { kind: "view", name: o.output.title ?? o.output.type, view: o.output, table: { columns: o.table.columns, rows: o.table.rows.slice(0, 300), total: o.table.rows.length, lineage: o.table.lin?.slice(0, 300) } },
      ),
    });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id: job.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
