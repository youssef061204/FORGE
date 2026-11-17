/**
 * Property checks chosen from a program's shape. Some guard intent (the files
 * the user named exist; numeric text isn't sorted as text); others guard
 * robustness (empty input, row order, doubled rows). A fatal failure rejects
 * the candidate and its hint drives a repair.
 */
import { parseDelimited } from "../codec/csv";
import { parseExpr, type Expr } from "../recipe/expr";
import { parseSortKey, runPlan, type Plan, type RunResult } from "../recipe/engine";
import { resolveName } from "../recipe/functions";
import type { Recipe } from "../recipe/schema";
import type { TableProfile } from "../profile";
import { keyOf, type Json, type Row } from "../table";
import { toText } from "../recipe/values";
import type { Inputs, Variant } from "./variants";

export type PropertyResult = { name: string; passed: boolean; fatal: boolean; detail?: string; hint?: string };

const FILE_NAME = /(?:^|[\s"'`(])([\w][\w.-]*\.(?:csv|tsv|json|jsonl|txt|text|md|log))\b/gi;
const EXT_FORMAT: Record<string, string> = { csv: "csv", tsv: "tsv", json: "json", jsonl: "json", txt: "text", text: "text", md: "text", log: "text" };

export type OutputShape = "table of rows" | "one object" | "object of key to value" | "list of values" | "lines of text" | "chart";

export function outputShape(o: Recipe["outputs"][number]): OutputShape {
  if (o.kind === "view") return "chart";
  if (o.format === "csv" || o.format === "tsv") return "table of rows";
  if (o.format === "text") return "lines of text";
  const s = o.shape;
  if (s === "row") return "one object";
  if (s && typeof s === "object" && "map" in s) return "object of key to value";
  if (s && typeof s === "object" && "values" in s) return "list of values";
  return "table of rows";
}

/** Keys of a JSON object template written in the request, e.g. {"total": number, "count": number}. */
export function templateKeys(request: string): { keys: string[]; at: number } | undefined {
  const m = /\{\s*"[^"]{1,60}"\s*:[^{}]{0,300}\}/.exec(request);
  if (!m) return undefined;
  const keys = [...m[0].matchAll(/"([^"]{1,60})"\s*:/g)].map((k) => k[1]);
  return keys.length ? { keys, at: m.index } : undefined;
}

/** "with columns a,b,c" or "columns: a, b" — an explicit, ordered column list. */
export function namedColumns(request: string): { columns: string[]; at: number } | undefined {
  const id = "`?[A-Za-z_][\\w.-]*`?";
  const m = new RegExp(
    `(?:\\b(?:with|only|keeping|containing|having)\\s+(?:only\\s+)?(?:the\\s+)?(?:\\w+\\s+)?columns?\\s*:?\\s+|\\bcolumns?\\s*:\\s*)(${id}(?:\\s*,\\s*${id})*(?:\\s*,?\\s+and\\s+${id})?)`,
    "i",
  ).exec(request);
  if (!m) return undefined;
  // Keep one separator style: "a,b" or "a, b and c". In "name,email, retaining
  // the first row" the list ends at email, where ", " starts a new clause.
  const parts = m[1].split(/(\s*,\s*|\s+and\s+)/);
  const columns = [parts[0]];
  const style = parts[1]?.includes(" ") ? "spaced" : "tight";
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const sep = parts[i];
    if ((sep.includes(" ") ? "spaced" : "tight") !== style && !/and/.test(sep)) break;
    columns.push(parts[i + 1]);
  }
  const clean = columns.map((c) => c.replace(/`/g, "").replace(/[.]$/, "").trim()).filter(Boolean);
  return clean.length >= 2 ? { columns: clean, at: m.index } : undefined;
}

export function mentionedFiles(request: string): string[] {
  const out = new Set<string>();
  for (const m of request.matchAll(FILE_NAME)) out.add(m[1]);
  return [...out];
}

function run(plan: Plan, inputs: Inputs, now?: string): RunResult | undefined {
  try {
    return runPlan(plan, inputs, { instrument: true, now, workLimit: 2_000_000 });
  } catch {
    return undefined;
  }
}

function rowsKey(rows: Row[], sorted: boolean): string {
  const keys = rows.map((r) => keyOf(r));
  return (sorted ? keys.sort() : keys).join("\n");
}

function topAggregate(source: string): string | undefined {
  try {
    const e: Expr = parseExpr(source);
    if (e.k === "call") return resolveName(e.fn);
  } catch {
    /* not parseable here; the compiler reported it */
  }
  return undefined;
}

export function checkProperties(args: {
  request: string;
  recipe: Recipe;
  plan: Plan;
  inputs: Inputs;
  inputNames: string[];
  profiles: Record<string, TableProfile>;
  variants: Variant[];
  now?: string;
  /** Shapes the separate intent call expected, by lowercased file name. */
  intentShapes?: Record<string, OutputShape>;
}): PropertyResult[] {
  const { request, recipe, plan, inputs, variants, now } = args;
  const results: PropertyResult[] = [];
  const base = run(plan, inputs, now);

  // 0. Two independent readings agree on what each file looks like.
  for (const o of recipe.outputs) {
    if (o.kind !== "file") continue;
    const want = args.intentShapes?.[o.name.toLowerCase()];
    if (!want || want === "chart") continue;
    const have = outputShape(o);
    const compatible = have === want || (want === "table of rows" && have === "lines of text" && false);
    if (!compatible)
      results.push({
        name: `Shape matches the request for ${o.name}`,
        passed: false,
        fatal: false,
        detail: `the request reads as ${want}, but this writes ${have}`,
        hint:
          want === "list of values"
            ? `write ${o.name} as a list: "shape": {"values": "<column>"}`
            : want === "one object"
              ? `write ${o.name} as one object: summarize without "by", then "shape": "row"`
              : want === "object of key to value"
                ? `write ${o.name} as {"map": {"key": "<column>", "value": "<column>"}}`
                : want === "lines of text"
                  ? `write ${o.name} as text with "shape": {"values": "<column>"}`
                  : `write ${o.name} as a table of rows (omit "shape")`,
      });
  }
  // The column list the user wrote, e.g. "with columns sku,quantity".
  const named = namedColumns(request);
  if (named && base) {
    const tables = base.outputs.filter((o) => o.kind === "file" && (o.format === "csv" || o.format === "tsv" || (o.format === "json" && Array.isArray(o.value) && o.value.every((x) => x && typeof x === "object")))) as Extract<RunResult["outputs"][number], { kind: "file" }>[];
    const near = tables.filter((o) => {
      const i = request.toLowerCase().indexOf(o.name.toLowerCase());
      return i >= 0 && Math.abs(named.at - i) < 80;
    });
    for (const o of near.length ? near : tables.length === 1 ? tables : []) {
      const ok = o.table.columns.join(",") === named.columns.join(",");
      results.push({
        name: `${o.name} has the columns you listed`,
        passed: ok,
        fatal: !ok,
        detail: ok ? named.columns.join(", ") : `expected ${named.columns.join(", ")}, wrote ${o.table.columns.join(", ")}`,
        hint: ok
          ? undefined
          : `end with {"op":"select","columns":${JSON.stringify(named.columns)}}` +
            (named.columns.some((c) => !o.table.columns.includes(c))
              ? `, after a step {"op":"derive","set":{${named.columns
                  .filter((c) => !o.table.columns.includes(c))
                  .map((c) => `"${c}":"<expression>"`)
                  .join(",")}}}`
              : ""),
      });
    }
  }
  const template = templateKeys(request);
  if (template && base) {
    const jsonOuts = base.outputs.filter((o) => o.kind === "file" && o.format === "json") as Extract<RunResult["outputs"][number], { kind: "file" }>[];
    const near = jsonOuts.filter((o) => {
      const i = request.toLowerCase().indexOf(o.name.toLowerCase());
      return i >= 0 && i < template.at && template.at - i < 80;
    });
    const targets = near.length ? near : jsonOuts.length === 1 ? jsonOuts : [];
    for (const o of targets) {
      const v = o.value;
      const ok = !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join("|") === [...template.keys].sort().join("|");
      results.push({
        name: `${o.name} has exactly the fields you wrote`,
        passed: ok,
        fatal: !ok,
        detail: ok ? template.keys.join(", ") : `expected one object with ${template.keys.join(", ")}`,
        hint: ok ? undefined : `produce one row with columns ${template.keys.join(", ")} (summarize without "by") and write it with "shape": "row"`,
      });
    }
  }

  // 1. The files the user named are the files it writes.
  const outNames = recipe.outputs.filter((o) => o.kind === "file").map((o) => (o as { name: string }).name);
  const wanted = mentionedFiles(request).filter((n) => !args.inputNames.some((i) => i.toLowerCase() === n.toLowerCase()));
  const missing = wanted.filter((n) => !outNames.some((o) => o.toLowerCase() === n.toLowerCase()));
  results.push({
    name: "Saves the files you named",
    passed: missing.length === 0,
    fatal: missing.length > 0,
    detail: missing.length ? `missing ${missing.join(", ")}` : wanted.length ? wanted.join(", ") : "no file names given",
    hint: missing.length ? `save the result as ${missing.join(" and ")}` : undefined,
  });

  // 2. File extensions agree with formats.
  for (const o of recipe.outputs) {
    if (o.kind !== "file") continue;
    const ext = o.name.split(".").pop()?.toLowerCase() ?? "";
    const expected = EXT_FORMAT[ext];
    if (expected && expected !== o.format)
      results.push({ name: `${o.name} is really ${expected.toUpperCase()}`, passed: false, fatal: true, hint: `use "format": "${expected}" for ${o.name}` });
  }

  // 3. Numbers stored as text are sorted as numbers.
  recipe.steps.forEach((step, i) => {
    if (step.op !== "sort") return;
    const source = plan.steps[i]?.source;
    const slotProfile = source ? args.profiles[source] : undefined;
    for (const key of step.by) {
      const { expr } = parseSortKey(key);
      const col = slotProfile?.columns.find((c) => c.name === expr.replace(/`/g, ""));
      if (col && col.storage === "text" && (col.kind === "number" || col.kind === "integer"))
        results.push({
          name: `Sorts ${col.name} as numbers`,
          passed: false,
          fatal: true,
          detail: `${col.name} holds numbers stored as text, so a plain sort would put 100 before 9`,
          hint: `sort by num(${col.name}) instead of ${col.name}`,
        });
    }
  });

  if (!base) return results;

  // 4. Works on an empty file.
  const empty = variants.find((v) => v.id === "empty");
  if (empty) {
    const r = run(plan, empty.inputs, now);
    results.push({ name: "Handles a file with no rows", passed: !!r, fatal: false, detail: r ? undefined : "stops with an error on an empty file" });
    if (r)
      for (const o of r.outputs)
        if (o.kind === "file" && (o.format === "csv" || o.format === "tsv"))
          results.push({ name: `${o.name} keeps its header when empty`, passed: o.text.split("\n")[0].length > 0, fatal: false });
  }

  // 5. Row order doesn't change grouped results.
  const shuffled = variants.find((v) => v.id === "shuffled");
  const usesOrder = recipe.steps.some((s) => s.op === "limit" || s.op === "dedupe" || (s.op === "summarize" && Object.values(s.set).some((x) => ["first", "last", "list"].includes(topAggregate(x) ?? ""))));
  if (shuffled && recipe.steps.some((s) => s.op === "summarize") && !usesOrder) {
    const r = run(plan, shuffled.inputs, now);
    const same =
      !!r &&
      r.outputs.every((o, k) => {
        const b = base.outputs[k];
        return o.kind === "file" && b.kind === "file" ? rowsKey(o.table.rows, true) === rowsKey(b.table.rows, true) : true;
      });
    results.push({ name: "Row order doesn't change the totals", passed: same, fatal: false });
  }

  // 6. Doubling every row doubles sums and counts, and leaves averages alone.
  const doubled = variants.find((v) => v.id === "doubled");
  const sIndex = recipe.steps.findIndex((s) => s.op === "summarize");
  if (doubled && sIndex >= 0 && plan.steps[sIndex]?.source === recipe.inputs[0].slot) {
    const step = recipe.steps[sIndex] as Extract<Recipe["steps"][number], { op: "summarize" }>;
    const r = run(plan, doubled.inputs, now);
    const before = base.snapshots?.[sIndex];
    const after = r?.snapshots?.[sIndex];
    if (before && after) {
      const by = step.by ?? [];
      const index = new Map(after.sample.map((row) => [keyOf(by.map((c) => row[c] ?? null)), row]));
      let ok = true;
      for (const row of before.sample) {
        const twin = index.get(keyOf(by.map((c) => row[c] ?? null)));
        if (!twin) continue;
        for (const [col, src] of Object.entries(step.set)) {
          const agg = topAggregate(src);
          const x = row[col],
            y = twin[col];
          if ((agg === "sum" || agg === "count") && typeof x === "number" && typeof y === "number") ok &&= Math.abs(y - 2 * x) < 1e-9 * Math.max(1, Math.abs(x));
          if (["mean", "min", "max", "median", "count_distinct"].includes(agg ?? "")) ok &&= keyOf(x as Json) === keyOf(y as Json);
        }
      }
      results.push({ name: "Doubling every row doubles sums and counts only", passed: ok, fatal: false });
    }
  }

  // 7. CSV output reads back to the same cells.
  for (const o of base.outputs) {
    if (o.kind !== "file" || (o.format !== "csv" && o.format !== "tsv")) continue;
    try {
      const back = parseDelimited(o.text, { delimiter: o.format === "tsv" ? "\t" : "," });
      const cols = o.table.columns;
      // The cell text the encoder writes: null and missing are empty, objects are JSON.
      const expected = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : (toText(v as never) as string));
      const same = back.rows.length === o.table.rows.length && back.rows.every((cells, i) => cols.every((c, j) => expected(o.table.rows[i][c]) === cells[j]));
      results.push({ name: `${o.name} reads back exactly`, passed: same, fatal: !same });
    } catch {
      results.push({ name: `${o.name} reads back exactly`, passed: false, fatal: true });
    }
  }

  // 8. Not silently empty on real data.
  const inputsHaveRows = Object.values(inputs).every((t) => t.rows.length > 0);
  for (const o of base.outputs)
    if (o.kind === "file" && inputsHaveRows && o.table.rows.length === 0)
      results.push({ name: `${o.name} has rows on your data`, passed: false, fatal: false, detail: "produces an empty result on the file you gave; check the conditions" });

  return results;
}
