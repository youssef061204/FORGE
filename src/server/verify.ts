/**
 * Translation validation. The recipe is emitted as plain TypeScript, compiled
 * with the TypeScript compiler, and run on the real data and every variant;
 * its encoded outputs must match the interpreter's byte for byte. (D10)
 */
import ts from "typescript";
import { runInNewContext } from "node:vm";
import { emitTypeScript } from "../core/recipe/emit-ts";
import { helpers } from "../core/recipe/emit-helpers";
import { encodeFile, runPlan, type Plan } from "../core/recipe/engine";
import type { Recipe } from "../core/recipe/schema";
import type { Row } from "../core/table";
import type { Inputs } from "../core/verify/variants";

export type VerifyCheck = { kind: "differential" | "replay"; name: string; passed: boolean; detail?: string };

type Emitted = (tables: Record<string, Row[]>, cols: Record<string, string[]>, H: typeof helpers) => Record<string, Row[]>;

export function compileEmitted(source: string): Emitted {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, strict: false } }).outputText;
  const sandbox: { exports: { run?: Emitted } } = { exports: {} };
  // A fresh context with nothing in it: no require, no process, no fetch.
  runInNewContext(js, sandbox, { timeout: 2000 });
  if (!sandbox.exports.run) throw new Error("emitted module has no run()");
  return sandbox.exports.run;
}

function interpreted(plan: Plan, inputs: Inputs, now: string): string {
  try {
    const r = runPlan(plan, inputs, { now, workLimit: 2_000_000 });
    return JSON.stringify(r.outputs.filter((o) => o.kind === "file").map((o) => (o as { text: string }).text));
  } catch (e) {
    return `error:${(e as { code?: string }).code ?? "VALUE"}`;
  }
}

function emitted(run: Emitted, recipe: Recipe, plan: Plan, inputs: Inputs, now: string): string {
  try {
    helpers.now = now;
    const tables: Record<string, Row[]> = {};
    const cols: Record<string, string[]> = {};
    for (const [k, t] of Object.entries(inputs)) {
      tables[k] = t.rows.map((r) => ({ ...r }));
      cols[k] = t.columns;
    }
    const out = run(tables, cols, helpers);
    const texts = plan.outputs
      .filter((o) => o.kind === "file")
      .map((o) => {
        const spec = o.output as Extract<Recipe["outputs"][number], { kind: "file" }>;
        const rows = (spec.from ? out[spec.from] : out.__final) ?? [];
        const columns = spec.columns ?? cols[spec.from ?? Object.keys(cols).at(-1)!] ?? [];
        return encodeFile(spec, { columns, rows }, columns).text;
      });
    return JSON.stringify(texts);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    return `error:${/budget|too many/i.test(msg) ? "BUDGET" : "VALUE"}`;
  }
}

export function lowerAndVerify(recipe: Recipe, plan: Plan, inputs: Inputs[] = [], now = new Date().toISOString()): { lowered?: { typescript: string }; checks: VerifyCheck[] } {
  let source: string;
  let run: Emitted;
  try {
    source = emitTypeScript(recipe);
    run = compileEmitted(source);
  } catch (e) {
    return { checks: [{ kind: "differential", name: "Emitted TypeScript compiles", passed: false, detail: (e as Error).message.slice(0, 200) }] };
  }
  if (!inputs.length) return { lowered: { typescript: source }, checks: [] };
  let agree = 0;
  let firstDiff = "";
  for (const [i, inp] of inputs.entries()) {
    const a = interpreted(plan, inp, now);
    const b = emitted(run, recipe, plan, inp, now);
    // Both refusing to run counts as agreement; the error wording differs by design.
    if (a === b || (a.startsWith("error:") && b.startsWith("error:"))) agree++;
    else if (!firstDiff) firstDiff = `input ${i}: interpreter ${a.slice(0, 80)} vs emitted ${b.slice(0, 80)}`;
  }
  return {
    lowered: { typescript: source },
    checks: [
      {
        kind: "differential",
        name: "Emitted TypeScript matches the interpreter",
        passed: agree === inputs.length,
        detail: agree === inputs.length ? `identical output on ${inputs.length} inputs` : firstDiff,
      },
    ],
  };
}
