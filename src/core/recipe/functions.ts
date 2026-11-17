/**
 * Every function a recipe expression may call. One table holds arity, result
 * type, behavior and the plain-English phrasing, so the evaluator and the
 * English renderer cannot drift apart.
 */
import type { Json } from "../table";
import { safeRegex } from "./regex";
import {
  asList,
  compare,
  dayText,
  equal,
  numberText,
  sortCompare,
  toBool,
  toDay,
  toNumber,
  toText,
  ValueError,
} from "./values";
import { keyOf } from "../table";

export type ValueType = "number" | "text" | "bool" | "list" | "object" | "any";
export type EvalContext = { now: string };

export type ScalarFn = {
  kind: "scalar";
  min: number;
  max: number;
  type: ValueType | ((args: ValueType[]) => ValueType);
  english: (a: string[]) => string;
  /** Lazy functions receive thunks so unused branches never run. */
  lazy?: (args: (() => Json)[], ctx: EvalContext) => Json;
  run?: (args: Json[], ctx: EvalContext) => Json;
  /** Text arguments that must be literal patterns (checked at build time). */
  patternArg?: number;
};
export type AggregateFn = {
  kind: "aggregate";
  min: number;
  max: number;
  type: ValueType | ((args: ValueType[]) => ValueType);
  english: (a: string[]) => string;
  reduce: (values: Json[]) => Json;
};
export type Fn = ScalarFn | AggregateFn;

const num = (v: Json) => toNumber(v);
const txt = (v: Json) => toText(v);
const nullish = (...vs: Json[]) => vs.some((v) => v === null);
const finite = (n: number) => {
  if (!Number.isFinite(n)) throw new ValueError("the arithmetic result is not a finite number");
  return n;
};

export function roundTo(x: number, digits: number): number {
  if (!Number.isInteger(digits) || digits < -6 || digits > 10)
    throw new ValueError("round() takes between -6 and 10 digits");
  const f = Math.pow(10, digits);
  // Round half away from zero on the decimal representation, not binary noise.
  const scaled = Number((Math.abs(x) * f).toPrecision(15));
  return (Math.sign(x) * Math.round(scaled)) / f;
}

const WEEKDAYS = ["Thursday", "Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday"];

function text1(english: (a: string) => string, f: (s: string) => Json): ScalarFn {
  return {
    kind: "scalar",
    min: 1,
    max: 1,
    type: "text",
    english: ([a]) => english(a),
    run: ([v]) => {
      const s = txt(v);
      return s === null ? null : f(s);
    },
  };
}
function num1(english: (a: string) => string, f: (n: number) => number): ScalarFn {
  return {
    kind: "scalar",
    min: 1,
    max: 1,
    type: "number",
    english: ([a]) => english(a),
    run: ([v]) => {
      const n = num(v);
      return n === null ? null : finite(f(n));
    },
  };
}

export const SCALARS: Record<string, ScalarFn> = {
  num: { kind: "scalar", min: 1, max: 1, type: "number", english: ([a]) => `${a} as a number`, run: ([v]) => num(v) },
  text: { kind: "scalar", min: 1, max: 1, type: "text", english: ([a]) => `${a} as text`, run: ([v]) => txt(v) },
  bool: { kind: "scalar", min: 1, max: 1, type: "bool", english: ([a]) => `${a} as true/false`, run: ([v]) => toBool(v) },
  lower: text1((a) => `${a} in lowercase`, (s) => s.toLowerCase()),
  upper: text1((a) => `${a} in uppercase`, (s) => s.toUpperCase()),
  trim: text1((a) => `${a} without surrounding spaces`, (s) => s.trim()),
  title: text1(
    (a) => `${a} in Title Case`,
    (s) => s.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase()),
  ),
  len: {
    kind: "scalar",
    min: 1,
    max: 1,
    type: "number",
    english: ([a]) => `the length of ${a}`,
    run: ([v]) => (v === null ? null : Array.isArray(v) ? v.length : [...(txt(v) as string)].length),
  },
  contains: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "bool",
    english: ([a, b]) => `${a} contains ${b}`,
    run: ([a, b]) => {
      if (Array.isArray(a)) return a.some((x) => equal(x, b));
      if (nullish(a, b)) return false;
      return (txt(a) as string).includes(txt(b) as string);
    },
  },
  icontains: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "bool",
    english: ([a, b]) => `${a} contains ${b} (ignoring case)`,
    run: ([a, b]) => (nullish(a, b) ? false : (txt(a) as string).toLowerCase().includes((txt(b) as string).toLowerCase())),
  },
  starts_with: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "bool",
    english: ([a, b]) => `${a} starts with ${b}`,
    run: ([a, b]) => (nullish(a, b) ? false : (txt(a) as string).startsWith(txt(b) as string)),
  },
  ends_with: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "bool",
    english: ([a, b]) => `${a} ends with ${b}`,
    run: ([a, b]) => (nullish(a, b) ? false : (txt(a) as string).endsWith(txt(b) as string)),
  },
  replace: {
    kind: "scalar",
    min: 3,
    max: 3,
    type: "text",
    english: ([a, b, c]) => `${a} with every ${b} replaced by ${c}`,
    run: ([a, b, c]) => {
      if (a === null) return null;
      const from = txt(b) ?? "";
      if (!from) return txt(a);
      return (txt(a) as string).split(from).join(txt(c) ?? "");
    },
  },
  regex_replace: {
    kind: "scalar",
    min: 3,
    max: 3,
    type: "text",
    patternArg: 1,
    english: ([a, b, c]) => `${a} with text matching ${b} replaced by ${c}`,
    run: ([a, b, c]) => (a === null ? null : safeRegex(txt(b) ?? "").replaceAll(txt(a) as string, txt(c) ?? "")),
  },
  left: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "text",
    english: ([a, n]) => `the first ${n} characters of ${a}`,
    run: ([a, n]) => (a === null ? null : [...(txt(a) as string)].slice(0, Math.max(0, num(n) ?? 0)).join("")),
  },
  right: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "text",
    english: ([a, n]) => `the last ${n} characters of ${a}`,
    run: ([a, n]) => {
      if (a === null) return null;
      const chars = [...(txt(a) as string)];
      const k = Math.max(0, num(n) ?? 0);
      return k === 0 ? "" : chars.slice(-k).join("");
    },
  },
  slice: {
    kind: "scalar",
    min: 2,
    max: 3,
    type: (t) => (t[0] === "list" ? "list" : "text"),
    english: ([a, b, c]) => (c ? `${a} from position ${b} up to ${c}` : `${a} from position ${b}`),
    run: ([a, b, c]) => {
      if (a === null) return null;
      const start = num(b) ?? 0;
      const end = c === undefined || c === null ? undefined : (num(c) ?? undefined);
      if (Array.isArray(a)) return a.slice(start, end);
      return [...(txt(a) as string)].slice(start, end).join("");
    },
  },
  split: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "list",
    english: ([a, b]) => `${a} split at each ${b}`,
    run: ([a, b]) => (a === null ? [] : (txt(a) as string).split(txt(b) ?? ",")),
  },
  split_part: {
    kind: "scalar",
    min: 3,
    max: 3,
    type: "text",
    english: ([a, b, n]) => `piece ${n} of ${a} split at ${b}`,
    run: ([a, b, n]) => {
      if (a === null) return null;
      const parts = (txt(a) as string).split(txt(b) ?? ",");
      const k = num(n) ?? 1;
      const index = k < 0 ? parts.length + k : k - 1;
      return parts[index] ?? null;
    },
  },
  join: {
    kind: "scalar",
    min: 1,
    max: 2,
    type: "text",
    english: ([a, b]) => `${a} joined with ${b ?? "', '"}`,
    run: ([a, b]) => asList(a).map((x) => txt(x) ?? "").join(b === undefined ? ", " : (txt(b) ?? "")),
  },
  concat: {
    kind: "scalar",
    min: 1,
    max: 16,
    type: "text",
    english: (a) => a.join(" followed by "),
    run: (args) => args.map((v) => txt(v) ?? "").join(""),
  },
  coalesce: {
    kind: "scalar",
    min: 1,
    max: 16,
    type: (t) => t.find((x) => x !== "any") ?? "any",
    english: (a) => a.join(", or else "),
    lazy: (args) => {
      for (const arg of args) {
        const v = arg();
        if (v !== null && v !== "") return v;
      }
      return null;
    },
  },
  if: {
    kind: "scalar",
    min: 2,
    max: 3,
    type: (t) => (t[1] === t[2] || t[2] === undefined ? t[1] : t[1] === "any" ? t[2] : t[2] === "any" ? t[1] : "any"),
    english: ([c, a, b]) => (b === undefined ? `${a} when ${c}` : `${a} when ${c}, otherwise ${b}`),
    lazy: ([c, a, b]) => {
      const cond = c();
      const truth = cond === null ? false : typeof cond === "boolean" ? cond : toBool(cond);
      return truth ? a() : b ? b() : null;
    },
  },
  is_null: {
    kind: "scalar",
    min: 1,
    max: 1,
    type: "bool",
    english: ([a]) => `${a} is missing`,
    run: ([v]) => v === null,
  },
  is_empty: {
    kind: "scalar",
    min: 1,
    max: 1,
    type: "bool",
    english: ([a]) => `${a} is empty`,
    run: ([v]) => v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0),
  },
  is_number: {
    kind: "scalar",
    min: 1,
    max: 1,
    type: "bool",
    english: ([a]) => `${a} is a number`,
    run: ([v]) => {
      try {
        return num(v) !== null;
      } catch {
        return false;
      }
    },
  },
  round: {
    kind: "scalar",
    min: 1,
    max: 2,
    type: "number",
    english: ([a, d]) => (d && d !== "0" ? `${a} rounded to ${d} decimal places` : `${a} rounded to a whole number`),
    run: ([v, d]) => {
      const n = num(v);
      return n === null ? null : roundTo(n, d === undefined ? 0 : (num(d) ?? 0));
    },
  },
  floor: num1((a) => `${a} rounded down`, Math.floor),
  ceil: num1((a) => `${a} rounded up`, Math.ceil),
  abs: num1((a) => `the absolute value of ${a}`, Math.abs),
  sqrt: num1((a) => `the square root of ${a}`, (n) => {
    if (n < 0) throw new ValueError("square root of a negative number");
    return Math.sqrt(n);
  }),
  least: {
    kind: "scalar",
    min: 1,
    max: 16,
    type: "number",
    english: (a) => `the smallest of ${a.join(", ")}`,
    run: (args) => {
      const ns = args.map(num).filter((n): n is number => n !== null);
      return ns.length ? Math.min(...ns) : null;
    },
  },
  greatest: {
    kind: "scalar",
    min: 1,
    max: 16,
    type: "number",
    english: (a) => `the largest of ${a.join(", ")}`,
    run: (args) => {
      const ns = args.map(num).filter((n): n is number => n !== null);
      return ns.length ? Math.max(...ns) : null;
    },
  },
  date: {
    kind: "scalar",
    min: 1,
    max: 1,
    type: "text",
    english: ([a]) => `${a} as a date`,
    run: ([v]) => {
      const d = toDay(v);
      return d === null ? null : dayText(d);
    },
  },
  year: { kind: "scalar", min: 1, max: 1, type: "number", english: ([a]) => `the year of ${a}`, run: ([v]) => part(v, 0) },
  month: { kind: "scalar", min: 1, max: 1, type: "number", english: ([a]) => `the month of ${a}`, run: ([v]) => part(v, 1) },
  day: { kind: "scalar", min: 1, max: 1, type: "number", english: ([a]) => `the day of the month of ${a}`, run: ([v]) => part(v, 2) },
  month_key: {
    kind: "scalar",
    min: 1,
    max: 1,
    type: "text",
    english: ([a]) => `the year and month of ${a}`,
    run: ([v]) => {
      const d = toDay(v);
      return d === null ? null : dayText(d).slice(0, 7);
    },
  },
  weekday: {
    kind: "scalar",
    min: 1,
    max: 1,
    type: "text",
    english: ([a]) => `the weekday of ${a}`,
    run: ([v]) => {
      const d = toDay(v);
      return d === null ? null : WEEKDAYS[((d % 7) + 7) % 7];
    },
  },
  days_between: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "number",
    english: ([a, b]) => `the number of days from ${a} to ${b}`,
    run: ([a, b]) => {
      const x = toDay(a),
        y = toDay(b);
      return x === null || y === null ? null : y - x;
    },
  },
  add_days: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "text",
    english: ([a, n]) => `${a} plus ${n} days`,
    run: ([a, n]) => {
      const d = toDay(a),
        k = num(n);
      return d === null || k === null ? null : dayText(d + Math.trunc(k));
    },
  },
  today: {
    kind: "scalar",
    min: 0,
    max: 0,
    type: "text",
    english: () => "today's date",
    run: (_, ctx) => ctx.now.slice(0, 10),
  },
  matches: {
    kind: "scalar",
    min: 2,
    max: 2,
    type: "bool",
    patternArg: 1,
    english: ([a, b]) => `${a} matches the pattern ${b}`,
    run: ([a, b]) => (a === null ? false : safeRegex(txt(b) ?? "").test(txt(a) as string)),
  },
  extract: {
    kind: "scalar",
    min: 2,
    max: 3,
    type: "text",
    patternArg: 1,
    english: ([a, b]) => `the part of ${a} matching ${b}`,
    run: ([a, b, g]) => {
      if (a === null) return null;
      const re = safeRegex(txt(b) ?? "");
      const m = re.exec(txt(a) as string);
      if (!m) return null;
      const group = g === undefined ? (re.groupCount >= 1 ? 1 : 0) : (num(g) ?? 0);
      return m.groups[group] ?? null;
    },
  },
};

function part(v: Json, index: number): number | null {
  const d = toDay(v);
  if (d === null) return null;
  return Number(dayText(d).split("-")[index]);
}

export const ALIASES: Record<string, string> = {
  number: "num",
  to_number: "num",
  float: "num",
  int: "num",
  str: "text",
  string: "text",
  to_text: "text",
  boolean: "bool",
  lowercase: "lower",
  uppercase: "upper",
  strip: "trim",
  length: "len",
  startswith: "starts_with",
  endswith: "ends_with",
  includes: "contains",
  substring: "slice",
  substr: "slice",
  iif: "if",
  if_else: "if",
  ifelse: "if",
  isnull: "is_null",
  is_blank: "is_empty",
  isempty: "is_empty",
  ceiling: "ceil",
  regexp_replace: "regex_replace",
  regex_match: "matches",
  regexp_extract: "extract",
  regex_extract: "extract",
  datediff: "days_between",
  date_add: "add_days",
  min_of: "least",
  max_of: "greatest",
  avg: "mean",
  average: "mean",
  n_distinct: "count_distinct",
  nunique: "count_distinct",
  collect: "list",
  concat_ws: "concat",
};

const numbers = (values: Json[]) => {
  const out: number[] = [];
  for (const v of values) {
    const n = toNumber(v);
    if (n !== null) out.push(n);
  }
  return out;
};

export const AGGREGATES: Record<string, AggregateFn> = {
  count: {
    kind: "aggregate",
    min: 0,
    max: 1,
    type: "number",
    english: ([a]) => (a ? `the number of rows with ${a}` : "the number of rows"),
    reduce: (values) => values.length,
  },
  count_distinct: {
    kind: "aggregate",
    min: 1,
    max: 1,
    type: "number",
    english: ([a]) => `the number of different ${a}`,
    reduce: (values) => new Set(values.filter((v) => v !== null).map(keyOf)).size,
  },
  sum: {
    kind: "aggregate",
    min: 1,
    max: 1,
    type: "number",
    english: ([a]) => `the total of ${a}`,
    reduce: (values) => numbers(values).reduce((s, n) => finite(s + n), 0),
  },
  mean: {
    kind: "aggregate",
    min: 1,
    max: 1,
    type: "number",
    english: ([a]) => `the average of ${a}`,
    reduce: (values) => {
      const ns = numbers(values);
      return ns.length ? finite(ns.reduce((s, n) => s + n, 0) / ns.length) : null;
    },
  },
  median: {
    kind: "aggregate",
    min: 1,
    max: 1,
    type: "number",
    english: ([a]) => `the median of ${a}`,
    reduce: (values) => {
      const ns = numbers(values).sort((x, y) => x - y);
      if (!ns.length) return null;
      const mid = Math.floor(ns.length / 2);
      return ns.length % 2 ? ns[mid] : (ns[mid - 1] + ns[mid]) / 2;
    },
  },
  min: {
    kind: "aggregate",
    min: 1,
    max: 1,
    type: (t) => t[0],
    english: ([a]) => `the smallest ${a}`,
    reduce: (values) => extreme(values, -1),
  },
  max: {
    kind: "aggregate",
    min: 1,
    max: 1,
    type: (t) => t[0],
    english: ([a]) => `the largest ${a}`,
    reduce: (values) => extreme(values, 1),
  },
  first: {
    kind: "aggregate",
    min: 1,
    max: 1,
    type: (t) => t[0],
    english: ([a]) => `the first ${a}`,
    reduce: (values) => values[0] ?? null,
  },
  last: {
    kind: "aggregate",
    min: 1,
    max: 1,
    type: (t) => t[0],
    english: ([a]) => `the last ${a}`,
    reduce: (values) => values.at(-1) ?? null,
  },
  list: {
    kind: "aggregate",
    min: 1,
    max: 1,
    type: "list",
    english: ([a]) => `the list of ${a}`,
    reduce: (values) => values,
  },
};

/** min/max over a group: numeric when every value reads as a number. */
function extreme(values: Json[], direction: 1 | -1): Json {
  const present = values.filter((v) => v !== null && v !== "");
  if (!present.length) return null;
  let allNumeric = true;
  for (const v of present) {
    if (typeof v === "number") continue;
    try {
      if (toNumber(v) === null) allNumeric = false;
    } catch {
      allNumeric = false;
    }
  }
  let best = present[0];
  for (const v of present.slice(1)) {
    const c = allNumeric ? (toNumber(v)! - toNumber(best)!) : (compare(v, best) ?? sortCompare(v, best));
    if (c * direction > 0) best = v;
  }
  return best;
}

export function resolveName(name: string): string {
  return ALIASES[name] ?? name;
}

/** In a summarize, a one-argument min/max is the aggregate. */
export function lookup(
  name: string,
  args: number,
  inSummary: boolean,
): { fn: Fn; name: string } | undefined {
  const n = resolveName(name);
  if (inSummary && AGGREGATES[n]) return { fn: AGGREGATES[n], name: n };
  if ((n === "min" || n === "max") && !inSummary)
    return { fn: SCALARS[n === "min" ? "least" : "greatest"], name: n === "min" ? "least" : "greatest" };
  if (SCALARS[n]) return { fn: SCALARS[n], name: n };
  if (AGGREGATES[n]) return { fn: AGGREGATES[n], name: n };
  void args;
  return undefined;
}

export const ALL_FUNCTION_NAMES = [...Object.keys(SCALARS), ...Object.keys(AGGREGATES), "min", "max"];

export { numberText };
