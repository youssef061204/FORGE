/**
 * The trusted recipe evaluator. compileRecipe() checks a recipe against the
 * real input schemas and returns located diagnostics, or a plan of closures.
 * runPlan() executes the plan over tables, optionally recording each step's
 * output and, per output row, which input rows contributed (lineage).
 *
 * No step can loop: every step is bounded by its input size, and a row-by-step
 * work budget bounds the whole run.
 */
import { keyOf, UNSAFE_KEYS, type Json, type Row, type Table } from "../table";
import { didYouMean, RecipeError, type Diagnostic } from "./diagnostics";
import { ExprError, parseExpr, walkExpr, type Expr } from "./expr";
import {
  AGGREGATES,
  ALL_FUNCTION_NAMES,
  lookup,
  type AggregateFn,
  type EvalContext,
  type ScalarFn,
  type ValueType,
} from "./functions";
import { RegexError, safeRegex } from "./regex";
import type { FileOutput, Output, Recipe, Step, ViewOutput } from "./schema";
import { compare, equal, numberText, passes, sortCompare, toNumber, toText, ValueError } from "./values";

export type ColumnInfo = { name: string; type: ValueType };
export type InputSchemas = Record<string, ColumnInfo[]>;

export const ENGINE_LIMITS = {
  work: 20_000_000,
  outputRows: 200_000,
  lineagePerRow: 5_000,
  sampleRows: 200,
};

type RowFn = (row: Row) => Json;
type AggFn = (rows: Row[]) => Json;
type Env = EvalContext;

type Windows = { list: AggFn[]; values: Json[]; columns: ColumnInfo[] };
type Ctx = {
  columns: ColumnInfo[];
  tables: string[];
  where: string;
  step?: number;
  env: Env;
  /** Whole-table aggregates allowed here (filter, derive, sort), computed once per run. */
  windows?: Windows;
};

class Fail extends Error {
  constructor(readonly d: Diagnostic) {
    super(d.message);
  }
}

function exprDiag(ctx: Ctx, source: string, at: number, message: string, hint?: string, code = "EXPR"): Fail {
  return new Fail({ code, where: ctx.where, step: ctx.step, message, hint, expr: source, at });
}

function parse(source: string, ctx: Ctx): Expr {
  try {
    return parseExpr(source);
  } catch (error) {
    if (error instanceof ExprError)
      throw new Fail({
        code: "PARSE",
        where: ctx.where,
        step: ctx.step,
        message: error.message,
        hint: error.hint,
        expr: source,
        at: error.at,
      });
    throw error;
  }
}

function resolveColumn(path: string[], ctx: Ctx, source: string, at: number): { get: RowFn; type: ValueType } {
  const names = ctx.columns.map((c) => c.name);
  const joined = path.join(".");
  if (names.includes(joined)) {
    const type = ctx.columns.find((c) => c.name === joined)!.type;
    return { get: (r) => (Object.hasOwn(r, joined) ? r[joined] : null), type };
  }
  let segments = path;
  if (!names.includes(path[0]) && path.length > 1 && ctx.tables.includes(path[0])) segments = path.slice(1);
  const head = segments[0];
  if (!names.includes(head)) {
    const guess = didYouMean(head, names);
    throw exprDiag(
      ctx,
      source,
      at,
      `unknown column "${head}"`,
      guess ? `did you mean ${guess}?` : `columns are ${names.slice(0, 12).join(", ")}`,
      "UNKNOWN_COLUMN",
    );
  }
  for (const s of segments) if (UNSAFE_KEYS.has(s)) throw exprDiag(ctx, source, at, `"${s}" is not allowed as a name`);
  const rest = segments.slice(1);
  const type: ValueType = rest.length ? "any" : ctx.columns.find((c) => c.name === head)!.type;
  return {
    type,
    get: (r) => {
      let v: Json = Object.hasOwn(r, head) ? r[head] : null;
      for (const s of rest) {
        if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
        v = Object.hasOwn(v, s) ? v[s] : null;
      }
      return v;
    },
  };
}

function arith(op: string, a: Json, b: Json): Json {
  const x = toNumber(a),
    y = toNumber(b);
  if (x === null || y === null) return null;
  let r: number;
  switch (op) {
    case "+":
      r = x + y;
      break;
    case "-":
      r = x - y;
      break;
    case "*":
      r = x * y;
      break;
    case "/":
      if (y === 0) return null;
      r = x / y;
      break;
    default:
      if (y === 0) return null;
      r = x % y;
  }
  if (!Number.isFinite(r)) throw new ValueError("the arithmetic result is not a finite number");
  return r;
}

function isNumericLiteral(e: Expr) {
  if (e.k !== "lit") return true;
  if (typeof e.v === "number" || e.v === null) return true;
  if (typeof e.v === "string") {
    try {
      return toNumber(e.v) !== null;
    } catch {
      return false;
    }
  }
  return false;
}

function compileScalar(e: Expr, ctx: Ctx, source: string): { fn: RowFn; type: ValueType } {
  switch (e.k) {
    case "lit": {
      const v = e.v;
      return { fn: () => v, type: v === null ? "any" : typeof v === "number" ? "number" : typeof v === "boolean" ? "bool" : "text" };
    }
    case "col": {
      const { get, type } = resolveColumn(e.path, ctx, source, e.s);
      return { fn: get, type };
    }
    case "list": {
      const items = e.items.map((i) => compileScalar(i, ctx, source).fn);
      return { fn: (r) => items.map((f) => f(r)), type: "list" };
    }
    case "neg": {
      const a = compileScalar(e.arg, ctx, source).fn;
      return {
        fn: (r) => {
          const n = toNumber(a(r));
          return n === null ? null : -n;
        },
        type: "number",
      };
    }
    case "not": {
      const a = compileScalar(e.arg, ctx, source).fn;
      return { fn: (r) => !passes(a(r)), type: "bool" };
    }
    case "bin": {
      const l = compileScalar(e.l, ctx, source);
      const r = compileScalar(e.r, ctx, source);
      const lf = l.fn,
        rf = r.fn;
      switch (e.op) {
        case "+":
        case "-":
        case "*":
        case "/":
        case "%": {
          for (const side of [e.l, e.r])
            if (!isNumericLiteral(side))
              throw exprDiag(
                ctx,
                source,
                side.s,
                `"${(side as { v: string }).v}" is text, and ${e.op} needs numbers`,
                e.op === "+" ? "use concat(a, b) to join text" : undefined,
                "TYPE",
              );
          for (const [side, info] of [
            [e.l, l],
            [e.r, r],
          ] as const)
            if (info.type === "bool" || info.type === "list" || info.type === "object")
              throw exprDiag(ctx, source, side.s, `${e.op} needs numbers, but this is a ${info.type}`, undefined, "TYPE");
          const op = e.op;
          return { fn: (row) => arith(op, lf(row), rf(row)), type: "number" };
        }
        case "==":
          return { fn: (row) => equal(lf(row), rf(row)), type: "bool" };
        case "!=":
          return {
            fn: (row) => {
              const a = lf(row),
                b = rf(row);
              return !equal(a, b);
            },
            type: "bool",
          };
        case "<":
        case "<=":
        case ">":
        case ">=": {
          const op = e.op;
          return {
            fn: (row) => {
              const c = compare(lf(row), rf(row));
              if (c === null) return false;
              return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
            },
            type: "bool",
          };
        }
        case "and":
          return { fn: (row) => passes(lf(row)) && passes(rf(row)), type: "bool" };
        case "or":
          return { fn: (row) => passes(lf(row)) || passes(rf(row)), type: "bool" };
        case "in": {
          if (r.type !== "list" && r.type !== "any" && e.r.k !== "list")
            throw exprDiag(ctx, source, e.r.s, '"in" needs a list such as [\'open\', \'pending\']', undefined, "TYPE");
          return {
            fn: (row) => {
              const v = lf(row);
              const list = rf(row);
              return Array.isArray(list) ? list.some((x) => equal(v, x)) : false;
            },
            type: "bool",
          };
        }
      }
      break;
    }
    case "call": {
      const found = lookup(e.fn, e.args.length, false);
      if (!found) {
        const guess = didYouMean(e.fn, ALL_FUNCTION_NAMES);
        throw exprDiag(ctx, source, e.s, `unknown function ${e.fn}()`, guess ? `did you mean ${guess}()?` : undefined, "UNKNOWN_FUNCTION");
      }
      if (found.fn.kind === "aggregate") {
        const windows = ctx.windows;
        if (!windows)
          throw exprDiag(
            ctx,
            source,
            e.s,
            `${e.fn}() summarizes many rows, so it cannot be used here`,
            undefined,
            "AGGREGATE_OUTSIDE_SUMMARY",
          );
        // A whole-table value such as sum(votes) inside a derive or filter.
        const agg = compileAggregate(e, { ...ctx, columns: windows.columns, windows: undefined }, source, []);
        const slot = windows.list.length;
        windows.list.push(agg.fn);
        return { fn: () => windows.values[slot], type: agg.type };
      }
      const fn = found.fn as ScalarFn;
      if (e.args.length < fn.min || e.args.length > fn.max)
        throw exprDiag(
          ctx,
          source,
          e.s,
          `${e.fn}() takes ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max}`} argument${fn.max === 1 ? "" : "s"}, not ${e.args.length}`,
          undefined,
          "ARITY",
        );
      if (fn.patternArg !== undefined) {
        const pat = e.args[fn.patternArg];
        if (!pat || pat.k !== "lit" || typeof pat.v !== "string")
          throw exprDiag(ctx, source, pat?.s ?? e.s, "the pattern must be written as text in quotes", undefined, "PATTERN");
        try {
          safeRegex(pat.v);
        } catch (error) {
          if (error instanceof RegexError)
            throw exprDiag(ctx, source, pat.s, `pattern problem: ${error.message}`, undefined, "PATTERN");
          throw error;
        }
      }
      const args = e.args.map((a) => compileScalar(a, ctx, source));
      const fns = args.map((a) => a.fn);
      const type = typeof fn.type === "function" ? fn.type(args.map((a) => a.type)) : fn.type;
      const env = ctx.env;
      if (fn.lazy) {
        const lazy = fn.lazy;
        return { fn: (row) => lazy(fns.map((f) => () => f(row)), env), type };
      }
      const run = fn.run!;
      if (fns.length === 1) {
        const f0 = fns[0];
        return { fn: (row) => run([f0(row)], env), type };
      }
      return { fn: (row) => run(fns.map((f) => f(row)), env), type };
    }
  }
  throw exprDiag(ctx, source, 0, "unsupported expression");
}

function compileAggregate(e: Expr, ctx: Ctx, source: string, keys: string[]): { fn: AggFn; type: ValueType } {
  switch (e.k) {
    case "lit": {
      const v = e.v;
      return { fn: () => v, type: typeof v === "number" ? "number" : "any" };
    }
    case "col": {
      const name = e.path.join(".");
      // A bare aggregate name such as "count" means count(), unless it is a real column.
      if (e.path.length === 1 && !ctx.columns.some((c) => c.name === name) && AGGREGATES[name] && AGGREGATES[name].min === 0)
        return compileAggregate({ k: "call", fn: name, args: [], s: e.s, e: e.e }, ctx, source, keys);
      if (!keys.includes(name) && !keys.includes(e.path[0]))
        throw exprDiag(
          ctx,
          source,
          e.s,
          `"${name}" differs between rows in a group`,
          `summarize it, for example sum(${name}), first(${name}) or count()`,
          "NOT_GROUPED",
        );
      const { get, type } = resolveColumn(e.path, ctx, source, e.s);
      return { fn: (rows) => (rows.length ? get(rows[0]) : null), type };
    }
    case "call": {
      const found = lookup(e.fn, e.args.length, true);
      if (found && found.fn.kind === "aggregate") {
        const agg = found.fn as AggregateFn;
        if (e.args.length < agg.min || e.args.length > agg.max)
          throw exprDiag(ctx, source, e.s, `${e.fn}() takes ${agg.max === 0 ? "no" : agg.min === agg.max ? agg.min : `${agg.min} to ${agg.max}`} argument${agg.max === 1 ? "" : "s"}`, undefined, "ARITY");
        let nested = false;
        e.args.forEach((a) =>
          walkExpr(a, (x) => {
            if (x.k === "call") {
              const inner = lookup(x.fn, x.args.length, true);
              if (inner?.fn.kind === "aggregate" && !(["min", "max"].includes(inner.name) && x.args.length > 1)) nested = true;
            }
          }),
        );
        if (nested) throw exprDiag(ctx, source, e.s, "a summary cannot contain another summary", undefined, "NESTED_AGGREGATE");
        const arg = e.args[0] ? compileScalar(e.args[0], { ...ctx, windows: undefined }, source) : undefined;
        const type = typeof agg.type === "function" ? agg.type([arg?.type ?? "any"]) : agg.type;
        if (!arg) return { fn: (rows) => agg.reduce(rows), type };
        const f = arg.fn;
        if (found.name === "count")
          return { fn: (rows) => rows.reduce((n, r) => (f(r) === null ? n : n + 1), 0), type };
        return { fn: (rows) => agg.reduce(rows.map(f)), type };
      }
      // A scalar function over summaries, e.g. round(mean(score), 1)
      const scalar = lookup(e.fn, e.args.length, false);
      if (!scalar) {
        const guess = didYouMean(e.fn, ALL_FUNCTION_NAMES);
        throw exprDiag(ctx, source, e.s, `unknown function ${e.fn}()`, guess ? `did you mean ${guess}()?` : undefined, "UNKNOWN_FUNCTION");
      }
      const fn = scalar.fn as ScalarFn;
      if (e.args.length < fn.min || e.args.length > fn.max)
        throw exprDiag(ctx, source, e.s, `${e.fn}() takes ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max}`} arguments`, undefined, "ARITY");
      const args = e.args.map((a) => compileAggregate(a, ctx, source, keys));
      const fns = args.map((a) => a.fn);
      const type = typeof fn.type === "function" ? fn.type(args.map((a) => a.type)) : fn.type;
      const env = ctx.env;
      if (fn.lazy) {
        const lazy = fn.lazy;
        return { fn: (rows) => lazy(fns.map((f) => () => f(rows)), env), type };
      }
      return { fn: (rows) => fn.run!(fns.map((f) => f(rows)), env), type };
    }
    case "bin": {
      const l = compileAggregate(e.l, ctx, source, keys).fn;
      const r = compileAggregate(e.r, ctx, source, keys).fn;
      const proxy = compileScalar(
        { ...e, l: { k: "col", path: ["__l"], s: e.l.s, e: e.l.e }, r: { k: "col", path: ["__r"], s: e.r.s, e: e.r.e } },
        { ...ctx, columns: [...ctx.columns, { name: "__l", type: "any" }, { name: "__r", type: "any" }] },
        source,
      );
      return { fn: (rows) => proxy.fn({ __l: l(rows), __r: r(rows) }), type: proxy.type };
    }
    case "neg": {
      const a = compileAggregate(e.arg, ctx, source, keys).fn;
      return {
        fn: (rows) => {
          const n = toNumber(a(rows));
          return n === null ? null : -n;
        },
        type: "number",
      };
    }
    case "not": {
      const a = compileAggregate(e.arg, ctx, source, keys).fn;
      return { fn: (rows) => !passes(a(rows)), type: "bool" };
    }
    case "list":
      throw exprDiag(ctx, source, e.s, "a summary must produce one value per group", undefined, "TYPE");
  }
}

// ---------------------------------------------------------------------------

export type TableData = { columns: string[]; rows: Row[]; lin?: number[][] };

export type StepSnapshot = {
  index: number;
  op: Step["op"];
  table: string;
  source: string;
  rowsIn: number;
  rowsOut: number;
  columns: string[];
  added: string[];
  removed: string[];
  sample: Row[];
  sampleLineage?: number[][];
  dropped?: { row: Row; lineage?: number[] }[];
};

type CompiledStep = {
  index: number;
  op: Step["op"];
  source: string;
  target: string;
  columns: ColumnInfo[];
  run: (input: TableData, tables: Map<string, TableData>, meter: Meter, track: boolean) => TableData & { dropped?: number[] };
};

export type CompiledOutput =
  | { kind: "file"; output: FileOutput; source: string; columns: string[] }
  | { kind: "view"; output: ViewOutput; source: string; columns: string[] };

export type Plan = {
  steps: CompiledStep[];
  outputs: CompiledOutput[];
  inputs: InputSchemas;
  tableSchemas: Record<string, ColumnInfo[]>;
  env: Env;
  recipe: Recipe;
};

class Meter {
  work = 0;
  constructor(readonly limit: number) {}
  add(n: number, step: number) {
    this.work += n;
    if (this.work > this.limit)
      throw new RecipeRuntimeError(step, `the run exceeded its work budget of ${this.limit.toLocaleString("en-US")} row-steps`, "WORK_BUDGET");
  }
}

export class RecipeRuntimeError extends Error {
  constructor(
    readonly step: number,
    message: string,
    readonly code = "RUNTIME",
    readonly rowIndex?: number,
  ) {
    super(step >= 0 ? `step ${step + 1}: ${message}` : message);
    this.name = "RecipeRuntimeError";
  }
}

function mergeLineage(a: number[] | undefined, b: number[] | undefined): number[] {
  if (!a) return b ? b.slice() : [];
  if (!b) return a.slice();
  const out = a.concat(b);
  return out.length > ENGINE_LIMITS.lineagePerRow ? out.slice(0, ENGINE_LIMITS.lineagePerRow) : out;
}

function joinKey(values: Json[]): string | null {
  let key = "";
  for (const v of values) {
    if (v === null) return null;
    const t = typeof v === "number" ? numberText(v) : typeof v === "string" ? v : keyOf(v);
    key += t.length + ":" + t + "|";
  }
  return key;
}

function parseSortKey(text: string): { expr: string; desc: boolean } {
  let t = text.trim();
  let desc = false;
  const m = /\s+(desc|descending|asc|ascending)$/i.exec(t);
  if (m) {
    desc = m[1].toLowerCase().startsWith("desc");
    t = t.slice(0, m.index).trim();
  } else if (t.startsWith("-") && /^-\s*[A-Za-z_`]/.test(t) && !/[+*/%<>=]/.test(t)) {
    desc = true;
    t = t.slice(1).trim();
  } else {
    const fn = /^desc\((.*)\)$/i.exec(t);
    if (fn) {
      desc = true;
      t = fn[1];
    }
  }
  return { expr: t, desc };
}
export { parseSortKey };

function guard<T>(step: number, f: () => T): T {
  try {
    return f();
  } catch (error) {
    if (error instanceof RecipeRuntimeError) throw error;
    if (error instanceof ValueError || error instanceof RegexError) throw new RecipeRuntimeError(step, error.message, "VALUE");
    throw error;
  }
}

function compileStep(step: Step, index: number, ctxBase: Omit<Ctx, "columns" | "where" | "step">, columns: ColumnInfo[], tableSchemas: Record<string, ColumnInfo[]>): { columns: ColumnInfo[]; run: CompiledStep["run"] } {
  const windows: Windows = { list: [], values: [], columns };
  const compiled = compileStepBody(step, index, { ...ctxBase, windows: step.op === "summarize" ? undefined : windows }, columns, tableSchemas);
  if (!windows.list.length) return compiled;
  const inner = compiled.run;
  return {
    columns: compiled.columns,
    run: (t, tables, meter, track) => {
      meter.add(t.rows.length * windows.list.length, index);
      windows.values = guard(index, () => windows.list.map((f) => f(t.rows)));
      return inner(t, tables, meter, track);
    },
  };
}

function compileStepBody(step: Step, index: number, ctxBase: Omit<Ctx, "columns" | "where" | "step">, columns: ColumnInfo[], tableSchemas: Record<string, ColumnInfo[]>): { columns: ColumnInfo[]; run: CompiledStep["run"] } {
  const where = `steps[${index}]`;
  const ctx: Ctx = { ...ctxBase, columns, where, step: index };
  const names = () => ctx.columns.map((c) => c.name);
  const need = (col: string, at: string): ColumnInfo => {
    const found = ctx.columns.find((c) => c.name === col);
    if (found) return found;
    const guess = didYouMean(col, names());
    throw new Fail({
      code: "UNKNOWN_COLUMN",
      where: `${where}.${at}`,
      step: index,
      message: `unknown column "${col}"`,
      hint: guess ? `did you mean ${guess}?` : `columns are ${names().slice(0, 12).join(", ")}`,
    });
  };
  const scalar = (source: string, at: string) => compileScalar(parse(source, { ...ctx, where: `${where}.${at}` }), { ...ctx, where: `${where}.${at}` }, source);

  switch (step.op) {
    case "filter": {
      const { fn } = scalar(step.where, "where");
      return {
        columns,
        run: (t, _, meter, track) => {
          meter.add(t.rows.length, index);
          const rows: Row[] = [];
          const lin: number[][] = [];
          const dropped: number[] = [];
          guard(index, () =>
            t.rows.forEach((r, i) => {
              if (passes(fn(r))) {
                rows.push(r);
                if (track && t.lin) lin.push(t.lin[i]);
              } else if (track) dropped.push(i);
            }),
          );
          return { columns: t.columns, rows, lin: track ? lin : undefined, dropped };
        },
      };
    }
    case "derive": {
      const sets: [string, RowFn][] = [];
      let cols = columns.slice();
      for (const [col, source] of Object.entries(step.set)) {
        if (UNSAFE_KEYS.has(col)) throw new Fail({ code: "NAME", where, step: index, message: `"${col}" is not allowed as a column name` });
        const c = compileScalar(parse(source, { ...ctx, columns: cols, where: `${where}.set.${col}` }), { ...ctx, columns: cols, where: `${where}.set.${col}` }, source);
        sets.push([col, c.fn]);
        cols = cols.some((x) => x.name === col) ? cols.map((x) => (x.name === col ? { name: col, type: c.type } : x)) : [...cols, { name: col, type: c.type }];
      }
      return {
        columns: cols,
        run: (t, _, meter) => {
          meter.add(t.rows.length * sets.length, index);
          const out = cols.map((c) => c.name);
          const rows = guard(index, () =>
            t.rows.map((r) => {
              const copy: Row = { ...r };
              for (const [col, fn] of sets) copy[col] = fn(copy);
              return copy;
            }),
          );
          return { columns: out, rows, lin: t.lin };
        },
      };
    }
    case "select":
    case "drop": {
      step.columns.forEach((c, i) => need(c, `columns[${i}]`));
      const keep = step.op === "select" ? step.columns : names().filter((n) => !step.columns.includes(n));
      const cols = keep.map((n) => ctx.columns.find((c) => c.name === n)!);
      return {
        columns: cols,
        run: (t, _, meter) => {
          meter.add(t.rows.length, index);
          return {
            columns: keep,
            rows: t.rows.map((r) => {
              const o: Row = {};
              for (const k of keep) o[k] = Object.hasOwn(r, k) ? r[k] : null;
              return o;
            }),
            lin: t.lin,
          };
        },
      };
    }
    case "rename": {
      const map = step.map;
      Object.keys(map).forEach((c) => need(c, `map.${c}`));
      for (const n of Object.values(map)) if (UNSAFE_KEYS.has(n)) throw new Fail({ code: "NAME", where, step: index, message: `"${n}" is not allowed as a column name` });
      const cols = ctx.columns.map((c) => (map[c.name] ? { ...c, name: map[c.name] } : c));
      const out = cols.map((c) => c.name);
      return {
        columns: cols,
        run: (t, _, meter) => {
          meter.add(t.rows.length, index);
          return {
            columns: out,
            rows: t.rows.map((r) => {
              const o: Row = {};
              for (const k of t.columns) o[map[k] ?? k] = Object.hasOwn(r, k) ? r[k] : null;
              return o;
            }),
            lin: t.lin,
          };
        },
      };
    }
    case "sort": {
      const keys = step.by.map((text, i) => {
        const { expr, desc } = parseSortKey(text);
        return { fn: scalar(expr, `by[${i}]`).fn, desc };
      });
      return {
        columns,
        run: (t, _, meter) => {
          meter.add(t.rows.length * Math.max(1, Math.ceil(Math.log2(t.rows.length + 1))), index);
          const decorated = guard(index, () => t.rows.map((r, i) => ({ i, k: keys.map((k) => k.fn(r)) })));
          decorated.sort((a, b) => {
            for (let j = 0; j < keys.length; j++) {
              const x = a.k[j],
                y = b.k[j];
              // nulls stay last in both directions
              if (x === null || y === null) {
                if (x === y) continue;
                return x === null ? 1 : -1;
              }
              const c = sortCompare(x, y);
              if (c) return keys[j].desc ? -c : c;
            }
            return a.i - b.i;
          });
          return {
            columns: t.columns,
            rows: decorated.map((d) => t.rows[d.i]),
            lin: t.lin ? decorated.map((d) => t.lin![d.i]) : undefined,
          };
        },
      };
    }
    case "dedupe": {
      const by = (step.by ?? []).map((s, i) => scalar(s, `by[${i}]`).fn);
      const keepLast = step.keep === "last";
      return {
        columns,
        run: (t, _, meter, track) => {
          meter.add(t.rows.length, index);
          const keys = guard(index, () => t.rows.map((r) => (by.length ? keyOf(by.map((f) => f(r))) : keyOf(r))));
          const chosen = new Map<string, number>();
          keys.forEach((k, i) => {
            if (keepLast || !chosen.has(k)) chosen.set(k, i);
          });
          const rows: Row[] = [];
          const lin: number[][] = [];
          const dropped: number[] = [];
          keys.forEach((k, i) => {
            if (chosen.get(k) === i) {
              rows.push(t.rows[i]);
              if (t.lin) lin.push(t.lin[i]);
            } else if (track) dropped.push(i);
          });
          return { columns: t.columns, rows, lin: t.lin ? lin : undefined, dropped };
        },
      };
    }
    case "summarize": {
      const by = step.by ?? [];
      by.forEach((c, i) => {
        if (!ctx.columns.some((x) => x.name === c)) {
          const guess = didYouMean(c, names());
          let hint = guess ? `did you mean ${guess}?` : undefined;
          if (!guess && /[()+\-*/ ]/.test(c)) hint = "group by a column; add a derive step first to compute it";
          throw new Fail({ code: "UNKNOWN_COLUMN", where: `${where}.by[${i}]`, step: index, message: `unknown column "${c}"`, hint });
        }
      });
      const sets: [string, AggFn][] = [];
      const cols: ColumnInfo[] = by.map((c) => ctx.columns.find((x) => x.name === c)!);
      for (const [col, source] of Object.entries(step.set)) {
        if (UNSAFE_KEYS.has(col)) throw new Fail({ code: "NAME", where, step: index, message: `"${col}" is not allowed as a column name` });
        if (by.includes(col))
          throw new Fail({ code: "NAME", where: `${where}.set.${col}`, step: index, message: `"${col}" is already a group column`, hint: `give the summary its own name, e.g. "${col === "count" ? "n" : "count"}": "count()"` });
        const sub = { ...ctx, where: `${where}.set.${col}` };
        const c = compileAggregate(parse(source, sub), sub, source, by);
        sets.push([col, c.fn]);
        cols.push({ name: col, type: c.type });
      }
      const out = cols.map((c) => c.name);
      return {
        columns: cols,
        run: (t, _, meter) => {
          meter.add(t.rows.length + t.rows.length * sets.length, index);
          const groups = new Map<string, number[]>();
          if (!by.length) groups.set("", t.rows.map((_, i) => i));
          else
            t.rows.forEach((r, i) => {
              const k = keyOf(by.map((c) => (Object.hasOwn(r, c) ? r[c] : null)));
              const g = groups.get(k);
              if (g) g.push(i);
              else groups.set(k, [i]);
            });
          const rows: Row[] = [];
          const lin: number[][] = [];
          guard(index, () => {
            for (const members of groups.values()) {
              const groupRows = members.map((i) => t.rows[i]);
              const o: Row = {};
              for (const c of by) o[c] = Object.hasOwn(groupRows[0], c) ? groupRows[0][c] : null;
              for (const [col, fn] of sets) o[col] = fn(groupRows);
              rows.push(o);
              if (t.lin) {
                let l: number[] = [];
                for (const i of members) {
                  l = l.concat(t.lin[i]);
                  if (l.length > ENGINE_LIMITS.lineagePerRow) {
                    l = l.slice(0, ENGINE_LIMITS.lineagePerRow);
                    break;
                  }
                }
                lin.push(l);
              }
            }
          });
          return { columns: out, rows, lin: t.lin ? lin : undefined };
        },
      };
    }
    case "join": {
      const right = tableSchemas[step.with];
      if (!right) {
        const guess = didYouMean(step.with, Object.keys(tableSchemas));
        throw new Fail({ code: "UNKNOWN_TABLE", where: `${where}.with`, step: index, message: `unknown table "${step.with}"`, hint: guess ? `did you mean ${guess}?` : `tables are ${Object.keys(tableSchemas).join(", ")}` });
      }
      const pairs: [string, string][] = Array.isArray(step.on) ? step.on.map((c) => [c, c]) : Object.entries(step.on);
      pairs.forEach(([l, r]) => {
        need(l, "on");
        if (!right.some((c) => c.name === r)) {
          const guess = didYouMean(r, right.map((c) => c.name));
          throw new Fail({ code: "UNKNOWN_COLUMN", where: `${where}.on`, step: index, message: `"${step.with}" has no column "${r}"`, hint: guess ? `did you mean ${guess}?` : undefined });
        }
      });
      const kind = step.kind ?? "inner";
      const rightKeys = new Set(pairs.map(([, r]) => r));
      const leftNames = new Set(names());
      const extra = right
        .filter((c) => !rightKeys.has(c.name))
        .map((c) => ({ from: c.name, to: leftNames.has(c.name) ? `${step.with}.${c.name}` : c.name, type: c.type }));
      const cols: ColumnInfo[] = kind === "anti" || kind === "semi" ? ctx.columns.slice() : [...ctx.columns, ...extra.map((x) => ({ name: x.to, type: x.type }))];
      const out = cols.map((c) => c.name);
      const withName = step.with;
      return {
        columns: cols,
        run: (t, tables, meter) => {
          const r = tables.get(withName)!;
          meter.add(t.rows.length + r.rows.length, index);
          const index_ = new Map<string, number[]>();
          r.rows.forEach((row, i) => {
            const k = joinKey(pairs.map(([, rc]) => (Object.hasOwn(row, rc) ? row[rc] : null)));
            if (k === null) return;
            const list = index_.get(k);
            if (list) list.push(i);
            else index_.set(k, [i]);
          });
          const rows: Row[] = [];
          const lin: number[][] = [];
          t.rows.forEach((row, i) => {
            const k = joinKey(pairs.map(([lc]) => (Object.hasOwn(row, lc) ? row[lc] : null)));
            const matches = k === null ? undefined : index_.get(k);
            if (kind === "anti") {
              if (!matches) {
                rows.push(row);
                if (t.lin) lin.push(t.lin[i]);
              }
              return;
            }
            if (kind === "semi") {
              if (matches) {
                rows.push(row);
                if (t.lin) lin.push(mergeLineage(t.lin[i], r.lin?.[matches[0]]));
              }
              return;
            }
            if (!matches) {
              if (kind === "left") {
                const o: Row = { ...row };
                for (const x of extra) o[x.to] = null;
                rows.push(o);
                if (t.lin) lin.push(t.lin[i]);
              }
              return;
            }
            meter.add(matches.length, index);
            for (const m of matches) {
              const o: Row = { ...row };
              const rr = r.rows[m];
              for (const x of extra) o[x.to] = Object.hasOwn(rr, x.from) ? rr[x.from] : null;
              rows.push(o);
              if (t.lin) lin.push(mergeLineage(t.lin[i], r.lin?.[m]));
              if (rows.length > ENGINE_LIMITS.outputRows * 5)
                throw new RecipeRuntimeError(index, "the join produced too many rows", "JOIN_BUDGET");
            }
          });
          return { columns: out, rows, lin: t.lin ? lin : undefined };
        },
      };
    }
    case "unnest":
    case "lines": {
      need(step.column, "column");
      const into = step.into ?? step.column;
      const col = step.column;
      const cols = ctx.columns.some((c) => c.name === into)
        ? ctx.columns.map((c) => (c.name === into ? { name: into, type: (step.op === "lines" ? "text" : "any") as ValueType } : c))
        : [...ctx.columns, { name: into, type: (step.op === "lines" ? "text" : "any") as ValueType }];
      const out = cols.map((c) => c.name);
      const isLines = step.op === "lines";
      return {
        columns: cols,
        run: (t, _, meter) => {
          const rows: Row[] = [];
          const lin: number[][] = [];
          guard(index, () =>
            t.rows.forEach((r, i) => {
              const v = Object.hasOwn(r, col) ? r[col] : null;
              let items: Json[];
              if (isLines) {
                const text = toText(v) ?? "";
                items = text.replace(/\r\n?/g, "\n").split("\n");
                if (items.at(-1) === "") items.pop();
              } else if (v === null) items = [];
              else if (Array.isArray(v)) items = v;
              else throw new ValueError(`"${col}" holds ${typeof v === "object" ? "an object" : "a single value"}, not a list`);
              meter.add(items.length + 1, index);
              for (const item of items) {
                rows.push({ ...r, [into]: item });
                if (t.lin) lin.push(t.lin[i]);
              }
            }),
          );
          return { columns: out, rows, lin: t.lin ? lin : undefined };
        },
      };
    }
    case "match": {
      need(step.column, "column");
      let re: ReturnType<typeof safeRegex>;
      try {
        re = safeRegex(step.pattern);
      } catch (error) {
        throw new Fail({ code: "PATTERN", where: `${where}.pattern`, step: index, message: error instanceof Error ? error.message : "invalid pattern", expr: step.pattern });
      }
      const named = re.groupNames.map((n, g) => [n, g] as const).filter(([n]) => n) as [string, number][];
      const fields: [string, number][] = named.length
        ? named
        : re.groupCount
          ? Array.from({ length: re.groupCount }, (_, g) => [re.groupCount === 1 ? "match" : `match${g + 1}`, g + 1])
          : [["match", 0]];
      for (const [n] of fields) if (UNSAFE_KEYS.has(n)) throw new Fail({ code: "NAME", where, step: index, message: `"${n}" is not allowed as a column name` });
      const cols = [...ctx.columns.filter((c) => !fields.some(([n]) => n === c.name)), ...fields.map(([n]) => ({ name: n, type: "text" as ValueType }))];
      const out = cols.map((c) => c.name);
      const col = step.column;
      const keepAll = step.keep === "all";
      return {
        columns: cols,
        run: (t, _, meter, track) => {
          meter.add(t.rows.length, index);
          const rows: Row[] = [];
          const lin: number[][] = [];
          const dropped: number[] = [];
          t.rows.forEach((r, i) => {
            const v = toText(Object.hasOwn(r, col) ? r[col] : null);
            const m = v === null ? null : re.exec(v);
            if (!m && !keepAll) {
              if (track) dropped.push(i);
              return;
            }
            const o: Row = { ...r };
            for (const [n, g] of fields) o[n] = m ? (m.groups[g] ?? null) : null;
            rows.push(o);
            if (t.lin) lin.push(t.lin[i]);
          });
          return { columns: out, rows, lin: t.lin ? lin : undefined, dropped };
        },
      };
    }
    case "limit": {
      const { n } = step;
      const offset = step.offset ?? 0;
      return {
        columns,
        run: (t, _, meter) => {
          meter.add(Math.min(t.rows.length, offset + n), index);
          return { columns: t.columns, rows: t.rows.slice(offset, offset + n), lin: t.lin?.slice(offset, offset + n) };
        },
      };
    }
    case "union": {
      const other = tableSchemas[step.with];
      if (!other) throw new Fail({ code: "UNKNOWN_TABLE", where: `${where}.with`, step: index, message: `unknown table "${step.with}"` });
      const cols = [...ctx.columns, ...other.filter((c) => !ctx.columns.some((x) => x.name === c.name))];
      const out = cols.map((c) => c.name);
      const withName = step.with;
      return {
        columns: cols,
        run: (t, tables, meter) => {
          const r = tables.get(withName)!;
          meter.add(t.rows.length + r.rows.length, index);
          const fill = (row: Row) => {
            const o: Row = {};
            for (const c of out) o[c] = Object.hasOwn(row, c) ? row[c] : null;
            return o;
          };
          return {
            columns: out,
            rows: [...t.rows.map(fill), ...r.rows.map(fill)],
            lin: t.lin && r.lin ? [...t.lin, ...r.lin] : undefined,
          };
        },
      };
    }
  }
}

/** Check a recipe against the real input schemas. Throws RecipeError. */
export function compileRecipe(recipe: Recipe, inputs: InputSchemas, options: { now?: string } = {}): Plan {
  const diagnostics: Diagnostic[] = [];
  const env: Env = { now: options.now ?? "1970-01-01T00:00:00.000Z" };
  const tableSchemas: Record<string, ColumnInfo[]> = {};
  const slots = new Set<string>();
  recipe.inputs.forEach((input, i) => {
    if (slots.has(input.slot)) diagnostics.push({ code: "DUPLICATE_INPUT", where: `inputs[${i}]`, message: `input "${input.slot}" is listed twice` });
    slots.add(input.slot);
    const schema = inputs[input.slot];
    if (!schema) {
      const guess = didYouMean(input.slot, Object.keys(inputs));
      diagnostics.push({
        code: "UNKNOWN_INPUT",
        where: `inputs[${i}].slot`,
        message: `no input named "${input.slot}"`,
        hint: guess ? `did you mean ${guess}?` : `inputs are ${Object.keys(inputs).join(", ")}`,
      });
    } else tableSchemas[input.slot] = schema;
  });
  if (diagnostics.length) throw new RecipeError(diagnostics);
  let current = recipe.inputs[0].slot;
  const steps: CompiledStep[] = [];
  const base = { tables: [...Object.keys(tableSchemas)], env };
  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i];
    const source = step.from ?? current;
    if (!tableSchemas[source]) {
      const guess = didYouMean(source, Object.keys(tableSchemas));
      diagnostics.push({ code: "UNKNOWN_TABLE", where: `steps[${i}].from`, step: i, message: `unknown table "${source}"`, hint: guess ? `did you mean ${guess}?` : undefined });
      break;
    }
    try {
      base.tables = Object.keys(tableSchemas);
      const compiled = compileStep(step, i, base, tableSchemas[source], tableSchemas);
      const target = step.as ?? `step${i + 1}`;
      if (step.as && slots.has(step.as)) throw new Fail({ code: "NAME", where: `steps[${i}].as`, step: i, message: `"${step.as}" is already an input name` });
      tableSchemas[target] = compiled.columns;
      steps.push({ index: i, op: step.op, source, target, columns: compiled.columns, run: compiled.run });
      current = target;
    } catch (error) {
      if (error instanceof Fail) {
        diagnostics.push(error.d);
        break; // later steps depend on this one's columns
      }
      throw error;
    }
  }
  const outputs: CompiledOutput[] = [];
  if (!diagnostics.length) {
    const names = new Set<string>();
    recipe.outputs.forEach((output: Output, i) => {
      const source = output.from ?? current;
      const schema = tableSchemas[source];
      const where = `outputs[${i}]`;
      if (!schema) {
        diagnostics.push({ code: "UNKNOWN_TABLE", where: `${where}.from`, message: `unknown table "${source}"` });
        return;
      }
      const cols = schema.map((c) => c.name);
      const check = (col: string | undefined, at: string) => {
        if (col === undefined) return;
        if (!cols.includes(col)) {
          const guess = didYouMean(col, cols);
          diagnostics.push({ code: "UNKNOWN_COLUMN", where: `${where}.${at}`, message: `output uses unknown column "${col}"`, hint: guess ? `did you mean ${guess}?` : `insert a step {"op":"derive","set":{"${col}":"<expression>"}} before saving; the columns now are ${cols.slice(0, 12).join(", ")}` });
        }
      };
      if (output.kind === "file") {
        if (names.has(output.name)) diagnostics.push({ code: "DUPLICATE_OUTPUT", where, message: `two outputs are named ${output.name}` });
        names.add(output.name);
        output.columns?.forEach((c, j) => check(c, `columns[${j}]`));
        const shape = output.shape;
        if (shape && typeof shape === "object" && "map" in shape) {
          check(shape.map.key, "shape.map.key");
          check(shape.map.value, "shape.map.value");
        }
        if (shape && typeof shape === "object" && "values" in shape) check(shape.values, "shape.values");
        if (output.format === "text" && !output.columns && !(shape && typeof shape === "object" && "values" in shape) && cols.length !== 1 && !cols.includes("line"))
          diagnostics.push({ code: "TEXT_COLUMN", where, message: "a text file writes one column per line; say which one", hint: `add "shape": {"values": "${cols[0]}"}` });
        outputs.push({ kind: "file", output, source, columns: output.columns ?? cols });
      } else {
        check(output.x, "x");
        check(output.y, "y");
        outputs.push({ kind: "view", output, source, columns: cols });
      }
    });
  }
  if (diagnostics.length) throw new RecipeError(diagnostics);
  return { steps, outputs, inputs, tableSchemas, env, recipe };
}

// ---------------------------------------------------------------------------

export type FileResult = {
  kind: "file";
  name: string;
  format: FileOutput["format"];
  text: string;
  bytes: number;
  table: TableData;
  value?: Json;
};
export type ViewResult = { kind: "view"; output: ViewOutput; table: TableData };
export type OutputResult = FileResult | ViewResult;

export type RunResult = {
  outputs: OutputResult[];
  snapshots?: StepSnapshot[];
  tables: Map<string, TableData>;
  work: number;
  ms: number;
  /** input row ids: id = offset[slot] + row index */
  offsets: Record<string, number>;
};

export type RunOptions = {
  instrument?: boolean;
  workLimit?: number;
  now?: string;
  sampleRows?: number;
};

export function encodeFile(output: FileOutput, table: TableData, columns: string[]): { text: string; value?: Json } {
  const cell = (r: Row, c: string): Json => (Object.hasOwn(r, c) ? r[c] : null);
  const shape = output.shape ?? "rows";
  if (output.format === "csv" || output.format === "tsv") {
    const d = output.format === "tsv" ? "\t" : ",";
    const enc = (v: Json) => {
      const s = v === null ? "" : typeof v === "object" ? JSON.stringify(v) : (toText(v) as string);
      return s.includes(d) || s.includes('"') || s.includes("\n") || s.includes("\r") || /^\s|\s$/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    };
    const lines = [columns.map((c) => enc(c)).join(d), ...table.rows.map((r) => columns.map((c) => enc(cell(r, c))).join(d))];
    return { text: lines.join("\n") + "\n" };
  }
  if (output.format === "text") {
    const col = typeof shape === "object" && "values" in shape ? shape.values : (output.columns?.[0] ?? (columns.includes("line") && columns.length > 1 ? "line" : columns[0]));
    return {
      text: table.rows
        .map((r) => {
          const v = cell(r, col);
          return (v === null ? "" : typeof v === "object" ? JSON.stringify(v) : toText(v)) + "\n";
        })
        .join(""),
    };
  }
  let value: Json;
  if (shape === "row") {
    if (table.rows.length !== 1) throw new ValueError(`${output.name} should hold one object, but there are ${table.rows.length} rows; for a list use "shape": {"values": "<column>"}, or omit shape for a list of rows`);
    value = Object.fromEntries(columns.map((c) => [c, cell(table.rows[0], c)]));
  } else if (typeof shape === "object" && "map" in shape) {
    const o: Record<string, Json> = {};
    for (const r of table.rows) {
      const k = toText(cell(r, shape.map.key));
      if (k === null) throw new ValueError(`a key in ${output.name} is missing`);
      if (UNSAFE_KEYS.has(k)) throw new ValueError(`"${k}" cannot be used as a key`);
      if (Object.hasOwn(o, k)) throw new ValueError(`the key "${k}" appears twice in ${output.name}; summarize by it first`);
      o[k] = cell(r, shape.map.value);
    }
    value = o;
  } else if (typeof shape === "object" && "values" in shape) value = table.rows.map((r) => cell(r, shape.values));
  else value = table.rows.map((r) => Object.fromEntries(columns.map((c) => [c, cell(r, c)])));
  return { text: JSON.stringify(value, null, 2) + "\n", value };
}

export function runPlan(plan: Plan, inputs: Record<string, Table>, options: RunOptions = {}): RunResult {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  plan.env.now = options.now ?? plan.env.now;
  const meter = new Meter(options.workLimit ?? ENGINE_LIMITS.work);
  const track = options.instrument === true;
  const sampleRows = options.sampleRows ?? ENGINE_LIMITS.sampleRows;
  const tables = new Map<string, TableData>();
  const offsets: Record<string, number> = {};
  let offset = 0;
  for (const slot of Object.keys(plan.inputs)) {
    const t = inputs[slot];
    if (!t) continue;
    offsets[slot] = offset;
    const base = offset;
    tables.set(slot, {
      columns: t.columns,
      rows: t.rows,
      lin: track ? t.rows.map((_, i) => [base + i]) : undefined,
    });
    offset += t.rows.length;
  }
  for (const input of plan.recipe.inputs)
    if (!tables.has(input.slot)) throw new RecipeRuntimeError(-1, `input "${input.slot}" was not provided`, "MISSING_INPUT");
  const snapshots: StepSnapshot[] = [];
  for (const step of plan.steps) {
    const input = tables.get(step.source)!;
    const result = step.run(input, tables, meter, track);
    if (result.rows.length > ENGINE_LIMITS.outputRows * 5)
      throw new RecipeRuntimeError(step.index, "the step produced too many rows", "ROW_BUDGET");
    tables.set(step.target, { columns: result.columns, rows: result.rows, lin: result.lin });
    if (track) {
      const before = new Set(input.columns);
      const after = new Set(result.columns);
      snapshots.push({
        index: step.index,
        op: step.op,
        table: step.target,
        source: step.source,
        rowsIn: input.rows.length,
        rowsOut: result.rows.length,
        columns: result.columns,
        added: result.columns.filter((c) => !before.has(c)),
        removed: input.columns.filter((c) => !after.has(c)),
        sample: result.rows.slice(0, sampleRows),
        sampleLineage: result.lin?.slice(0, sampleRows),
        dropped: result.dropped?.slice(0, 50).map((i) => ({ row: input.rows[i], lineage: input.lin?.[i] })),
      });
    }
  }
  const outputs: OutputResult[] = plan.outputs.map((o, i) => {
    const table = tables.get(o.source)!;
    if (o.kind === "view") return { kind: "view", output: o.output, table };
    if (table.rows.length > ENGINE_LIMITS.outputRows)
      throw new RecipeRuntimeError(-1, `${o.output.name} would have more than ${ENGINE_LIMITS.outputRows.toLocaleString("en-US")} rows`, "OUTPUT_BUDGET");
    const { text, value } = guard(-1, () => encodeFile(o.output, table, o.columns));
    void i;
    return {
      kind: "file",
      name: o.output.name,
      format: o.output.format,
      text,
      bytes: new TextEncoder().encode(text).length,
      table: { columns: o.columns, rows: table.rows, lin: table.lin },
      value,
    };
  });
  const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { outputs, snapshots: track ? snapshots : undefined, tables, work: meter.work, ms: ended - started, offsets };
}

export { AGGREGATES };
