/**
 * Deterministic English, rendered from the syntax tree and never from a model.
 * An explanation built this way cannot promise more than the program does.
 */
import { parseExpr, type Expr } from "./expr";
import { AGGREGATES, lookup, SCALARS } from "./functions";
import { parseSortKey } from "./engine";
import type { Output, Recipe, Step } from "./schema";

const OPS: Record<string, string> = {
  "+": "+",
  "-": "−",
  "*": "×",
  "/": "÷",
  "%": "mod",
};
const CMP: Record<string, string> = {
  "==": "is",
  "!=": "is not",
  "<": "is less than",
  "<=": "is at most",
  ">": "is more than",
  ">=": "is at least",
};

function lit(v: unknown): string {
  if (typeof v === "string") return v === "" ? "empty" : `“${v}”`;
  if (v === null) return "nothing";
  return String(v);
}

export function englishExpr(e: Expr, summary = false, depth = 0): string {
  const sub = (x: Expr) => englishExpr(x, summary, depth + 1);
  switch (e.k) {
    case "lit":
      return lit(e.v);
    case "col":
      return e.path.join(".");
    case "list":
      return e.items.map(sub).join(", ");
    case "neg":
      return `−${sub(e.arg)}`;
    case "not":
      if (e.arg.k === "col") return `${sub(e.arg)} is false`;
      if (e.arg.k === "call" && e.arg.fn === "is_null") return `${sub(e.arg.args[0])} is present`;
      if (e.arg.k === "bin" && e.arg.op === "in") return `${sub(e.arg.l)} is not one of ${sub(e.arg.r)}`;
      return `not (${sub(e.arg)})`;
    case "bin": {
      if (OPS[e.op]) {
        const text = `${sub(e.l)} ${OPS[e.op]} ${sub(e.r)}`;
        return depth > 0 && (e.op === "+" || e.op === "-") ? `(${text})` : text;
      }
      if (CMP[e.op]) {
        if (e.r.k === "lit" && e.r.v === "" && (e.op === "==" || e.op === "!="))
          return `${sub(e.l)} ${e.op === "==" ? "is empty" : "is not empty"}`;
        return `${sub(e.l)} ${CMP[e.op]} ${sub(e.r)}`;
      }
      if (e.op === "in") return `${sub(e.l)} is one of ${sub(e.r)}`;
      return `${sub(e.l)} ${e.op} ${sub(e.r)}`;
    }
    case "call": {
      // Conversions are invisible in prose: "num(price)" reads as "price".
      if ((e.fn === "num" || e.fn === "number" || e.fn === "text" || e.fn === "str") && e.args.length === 1) return sub(e.args[0]);
      const found = lookup(e.fn, e.args.length, summary);
      const args = e.args.map(sub);
      if (found) {
        if (found.name === "count" && args.length === 0) return "the number of rows";
        return found.fn.english(args);
      }
      return `${e.fn}(${args.join(", ")})`;
    }
  }
}

function safeExpr(text: string, summary = false): string {
  try {
    return englishExpr(parseExpr(text), summary);
  } catch {
    return text;
  }
}

const q = (name: string) => `“${name}”`;
const list = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

export function englishStep(step: Step, known: Set<string> = new Set()): string {
  switch (step.op) {
    case "filter":
      return `Keep rows where ${safeExpr(step.where)}.`;
    case "derive": {
      const parts = Object.entries(step.set).map(([col, expr]) => {
        const body = safeExpr(expr);
        return known.has(col) ? `replace ${q(col)} with ${body}` : `add a column ${q(col)} = ${body}`;
      });
      const text = list(parts);
      return text[0].toUpperCase() + text.slice(1) + ".";
    }
    case "select":
      return `Keep only the columns ${list(step.columns.map(q))}.`;
    case "drop":
      return `Remove the columns ${list(step.columns.map(q))}.`;
    case "rename":
      return `Rename ${list(Object.entries(step.map).map(([a, b]) => `${q(a)} to ${q(b)}`))}.`;
    case "sort": {
      const keys = step.by.map((b) => {
        const { expr, desc } = parseSortKey(b);
        return `${safeExpr(expr)} (${desc ? "largest first" : "smallest first"})`;
      });
      return `Sort by ${list(keys)}.`;
    }
    case "dedupe": {
      const by = step.by?.length ? `the same ${list(step.by.map((b) => safeExpr(b)))}` : "identical content";
      return `Remove repeated rows with ${by}, keeping the ${step.keep ?? "first"} one.`;
    }
    case "summarize": {
      const sets = Object.entries(step.set).map(([col, expr]) => `${q(col)} = ${safeExpr(expr, true)}`);
      return step.by?.length
        ? `Group by ${list(step.by.map(q))} and compute ${list(sets)}.`
        : `Combine all rows into one and compute ${list(sets)}.`;
    }
    case "join": {
      const on = Array.isArray(step.on) ? list(step.on.map(q)) : list(Object.entries(step.on).map(([a, b]) => `${q(a)} = ${q(b)}`));
      const kind = step.kind ?? "inner";
      if (kind === "anti") return `Keep only rows with no match in ${step.with} by ${on}.`;
      if (kind === "semi") return `Keep only rows that have a match in ${step.with} by ${on}.`;
      return `Match each row with ${step.with} by ${on}${kind === "left" ? ", keeping rows without a match" : ", dropping rows without a match"}.`;
    }
    case "unnest":
      return `Turn each item of ${q(step.column)} into its own row.`;
    case "lines":
      return `Split ${q(step.column)} into one row per line.`;
    case "match": {
      return `${step.keep === "all" ? "Look for" : "Keep rows where"} ${q(step.column)} matches the pattern ${step.pattern}${step.keep === "all" ? "" : ", and pull out the matched parts"}.`;
    }
    case "limit":
      return step.offset ? `Skip ${step.offset} rows, then keep the next ${step.n}.` : `Keep the first ${step.n} rows.`;
    case "union":
      return `Add the rows of ${step.with} underneath.`;
  }
}

export function englishOutput(output: Output): string {
  if (output.kind === "view") {
    const what = output.type === "table" ? "a table" : output.type === "stat" ? "a single number" : `a ${output.type} chart`;
    return output.x && output.y ? `Show ${what} of ${output.y} by ${output.x}.` : `Show ${what}.`;
  }
  const shape = output.shape;
  let detail = "";
  if (shape && typeof shape === "object" && "map" in shape) detail = ` as ${shape.map.key} → ${shape.map.value}`;
  else if (shape && typeof shape === "object" && "values" in shape) detail = ` as a list of ${shape.values}`;
  else if (shape === "row") detail = " as a single object";
  else if (output.columns) detail = ` with columns ${output.columns.join(", ")}`;
  return `Save ${output.name}${detail}.`;
}

export type EnglishLine = { kind: "input" | "step" | "output"; index: number; text: string };

export function englishRecipe(recipe: Recipe, columnsOf?: (slot: string) => string[]): EnglishLine[] {
  const lines: EnglishLine[] = recipe.inputs.map((input, i) => ({
    kind: "input",
    index: i,
    text: `Read ${input.slot}${input.format ? ` (${input.format.toUpperCase()})` : ""}.`,
  }));
  const known = new Set<string>(columnsOf?.(recipe.inputs[0].slot) ?? []);
  recipe.steps.forEach((step, i) => {
    lines.push({ kind: "step", index: i, text: englishStep(step, known) });
    if (step.op === "derive") Object.keys(step.set).forEach((c) => known.add(c));
  });
  recipe.outputs.forEach((output, i) => lines.push({ kind: "output", index: i, text: englishOutput(output) }));
  return lines;
}

export { AGGREGATES, SCALARS };
