/**
 * Tolerant reading of model output: extract the JSON object, then repair the
 * small, unambiguous shape slips small models make (an op spelled "group_by",
 * derive written as {column, expr}). Anything ambiguous is left for the
 * validator to reject with a located diagnostic.
 */
import { recipeSchema, type Recipe } from "../recipe/schema";
import type { Diagnostic } from "../recipe/diagnostics";

export function extractJson(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through */
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new SyntaxError("no JSON object in the response");
}

const OP_ALIASES: Record<string, string> = {
  where: "filter",
  keep: "filter",
  mutate: "derive",
  compute: "derive",
  add_column: "derive",
  addcolumn: "derive",
  assign: "derive",
  project: "select",
  columns: "select",
  keep_columns: "select",
  remove: "drop",
  drop_columns: "drop",
  order: "sort",
  order_by: "sort",
  orderby: "sort",
  arrange: "sort",
  sort_by: "sort",
  distinct: "dedupe",
  unique: "dedupe",
  deduplicate: "dedupe",
  drop_duplicates: "dedupe",
  group: "summarize",
  group_by: "summarize",
  groupby: "summarize",
  aggregate: "summarize",
  summarise: "summarize",
  merge: "join",
  lookup: "join",
  explode: "unnest",
  flatten: "unnest",
  split_lines: "lines",
  regex: "match",
  extract: "match",
  take: "limit",
  head: "limit",
  top: "limit",
  append: "union",
  concat: "union",
};

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toSetMap(step: Record<string, unknown>): void {
  // {column:"x", expr:"..."} or {name, expression} or [{x: "..."}]
  const name = step.column ?? step.name ?? step.as_column ?? step.new_column;
  const expr = step.expr ?? step.expression ?? step.value ?? step.formula;
  if (!isObj(step.set) && typeof name === "string" && typeof expr === "string") {
    step.set = { [name]: expr };
    for (const k of ["column", "name", "as_column", "new_column", "expr", "expression", "value", "formula"]) delete step[k];
  }
  if (Array.isArray(step.set)) {
    const out: Record<string, unknown> = {};
    for (const item of step.set) {
      if (isObj(item)) {
        const n = item.column ?? item.name;
        const e = item.expr ?? item.expression ?? item.value;
        if (typeof n === "string" && typeof e === "string") out[n] = e;
        else Object.assign(out, item);
      } else if (typeof item === "string" && item.includes("=")) {
        const i = item.indexOf("=");
        out[item.slice(0, i).trim()] = item.slice(i + 1).trim();
      }
    }
    step.set = out;
  }
  for (const k of ["columns", "aggregates", "aggregations", "metrics", "compute"])
    if (step.op === "summarize" && !step.set && isObj(step[k])) {
      step.set = step[k];
      delete step[k];
    }
}

export function normalizeRecipe(raw: unknown): unknown {
  if (!isObj(raw)) return raw;
  const r: Record<string, unknown> = { ...raw };
  if (isObj(r.recipe)) return normalizeRecipe(r.recipe);
  if (!Array.isArray(r.inputs) && isObj(r.inputs)) r.inputs = [r.inputs];
  if (Array.isArray(r.inputs))
    r.inputs = r.inputs.map((i) => (typeof i === "string" ? { slot: i } : isObj(i) && !i.slot && typeof i.name === "string" ? { ...i, slot: i.name, name: undefined } : i));
  if (Array.isArray(r.inputs))
    r.inputs = (r.inputs as unknown[]).map((i) => (isObj(i) ? Object.fromEntries(Object.entries(i).filter(([k, v]) => v !== undefined && ["slot", "format", "path"].includes(k))) : i));
  if (!Array.isArray(r.outputs) && isObj(r.outputs)) r.outputs = [r.outputs];
  if (!Array.isArray(r.outputs) && isObj(r.output)) {
    r.outputs = [r.output];
    delete r.output;
  }
  if (Array.isArray(r.steps))
    r.steps = r.steps.map((s) => {
      if (!isObj(s)) return s;
      const step: Record<string, unknown> = { ...s };
      if (typeof step.op !== "string" && typeof step.type === "string") {
        step.op = step.type;
        delete step.type;
      }
      if (typeof step.op === "string") {
        const op = step.op.toLowerCase().trim();
        step.op = OP_ALIASES[op] ?? op;
      }
      if (step.op === "filter" && typeof step.where !== "string") {
        const w = step.condition ?? step.expr ?? step.expression ?? step.if;
        if (typeof w === "string") {
          step.where = w;
          for (const k of ["condition", "expr", "expression", "if"]) delete step[k];
        }
      }
      if (step.op === "derive" || step.op === "summarize") toSetMap(step);
      if (step.op === "summarize") {
        const by = step.by ?? step.group_by ?? step.groupBy ?? step.keys;
        if (typeof by === "string") step.by = [by];
        else if (Array.isArray(by)) step.by = by;
        for (const k of ["group_by", "groupBy", "keys"]) delete step[k];
      }
      if ((step.op === "sort" || step.op === "dedupe") && typeof step.by === "string") step.by = [step.by];
      if (step.op === "sort" && Array.isArray(step.by))
        step.by = step.by.map((b) =>
          isObj(b) ? `${String(b.expr ?? b.column ?? b.key ?? "")}${b.desc === true || /desc/i.test(String(b.order ?? b.direction ?? "")) ? " desc" : ""}` : b,
        );
      if ((step.op === "select" || step.op === "drop") && typeof step.columns === "string") step.columns = [step.columns];
      if (step.op === "join" && typeof step.on === "string") step.on = [step.on];
      if (step.op === "join" && typeof step.with !== "string" && typeof step.table === "string") {
        step.with = step.table;
        delete step.table;
      }
      if (step.op === "join" && typeof step.how === "string" && !step.kind) {
        step.kind = step.how;
        delete step.how;
      }
      if (step.op === "limit" && typeof step.n !== "number") {
        const n = step.count ?? step.rows ?? step.limit;
        if (typeof n === "number") {
          step.n = n;
          delete step.count;
          delete step.rows;
          delete step.limit;
        }
      }
      if (step.op === "rename" && isObj(step.map)) step.map = Object.fromEntries(Object.entries(step.map).filter(([a, b]) => a !== b));
      // Empty optional fields from grammar-constrained output.
      for (const [k, v] of Object.entries(step)) if (v === "" && ["as", "from", "into", "note", "keep", "kind"].includes(k)) delete step[k];
      if (Array.isArray(step.by) && step.by.length === 0 && step.op !== "dedupe") delete step.by;
      return step;
    });
  // A rename that renames nothing is dropped.
  if (Array.isArray(r.steps)) r.steps = (r.steps as unknown[]).filter((s) => !(isObj(s) && s.op === "rename" && isObj(s.map) && Object.keys(s.map).length === 0));
  // select ["pricing.price as price", "name"] -> derive {price: pricing.price} + select [price, name]
  if (Array.isArray(r.steps))
    r.steps = (r.steps as unknown[]).flatMap((s) => {
      if (!isObj(s) || s.op !== "select" || !Array.isArray(s.columns)) return [s];
      const set: Record<string, string> = {};
      const columns = (s.columns as unknown[]).map((c) => {
        if (typeof c !== "string") return c;
        const alias = /^(.+?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(c.trim());
        if (alias) {
          set[alias[2]] = alias[1];
          return alias[2];
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(c.trim())) {
          const name = c.trim().split(".").pop()!;
          set[name] = c.trim();
          return name;
        }
        return c;
      });
      if (!Object.keys(set).length) return [s];
      const { as: _as, ...rest } = s;
      return [{ op: "derive", set, ...(rest.from ? { from: rest.from } : {}) }, { ...rest, from: undefined, columns, ...(_as ? { as: _as } : {}) }].map((x) =>
        Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)),
      );
    });
  if (Array.isArray(r.outputs))
    r.outputs = r.outputs.map((o) => {
      if (!isObj(o)) return o;
      const out: Record<string, unknown> = { ...o };
      if (!out.kind) out.kind = out.type && ["bar", "line", "table", "stat"].includes(String(out.type)) ? "view" : "file";
      if (out.kind === "file" && typeof out.name !== "string" && typeof out.file === "string") {
        out.name = out.file;
        delete out.file;
      }
      if (out.kind === "file" && !out.format && typeof out.name === "string") {
        const ext = out.name.split(".").pop()?.toLowerCase();
        out.format = ext === "txt" ? "text" : ext;
      }
      for (const [k, v] of Object.entries(out))
        if ((v === "" || (Array.isArray(v) && v.length === 0)) && ["from", "columns", "shape", "x", "y", "title"].includes(k)) delete out[k];
      if (out.shape === "map" || out.shape === "object" || out.shape === "values") delete out.shape;
      return out;
    });
  return r;
}

export type ParsedRecipe = { ok: true; recipe: Recipe } | { ok: false; stage: "schema"; diagnostics: Diagnostic[] };

export function parseRecipeText(text: string): ParsedRecipe {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (error) {
    return { ok: false, stage: "schema", diagnostics: [{ code: "JSON", where: "", message: error instanceof Error ? error.message : "not JSON" }] };
  }
  const parsed = recipeSchema.safeParse(normalizeRecipe(raw));
  if (parsed.success) return { ok: true, recipe: parsed.data };
  return {
    ok: false,
    stage: "schema",
    diagnostics: parsed.error.issues.slice(0, 4).map((i) => ({
      code: "SCHEMA",
      where: i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("").replace(/^\./, ""),
      message: i.message,
    })),
  };
}
