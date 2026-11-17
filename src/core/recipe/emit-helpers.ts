/** The helper object emitted TypeScript calls: value semantics only, no step logic. */
import { keyOf, type Json, type Row } from "../table";
import { AGGREGATES, SCALARS } from "./functions";
import { safeRegex, type SafeRegex } from "./regex";
import { compare, equal, numberText, passes, sortCompare, toNumber, toText, ValueError } from "./values";

export const helpers = {
  now: "1970-01-01T00:00:00.000Z",
  own: (r: Row, c: string): Json => (Object.hasOwn(r, c) ? r[c] : null),
  col(r: Row, path: string[]): Json {
    const joined = path.join(".");
    if (Object.hasOwn(r, joined)) return r[joined];
    let v: Json = Object.hasOwn(r, path[0]) ? r[path[0]] : null;
    for (const s of path.slice(1)) {
      if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
      v = Object.hasOwn(v, s) ? v[s] : null;
    }
    return v;
  },
  neg: (v: Json) => {
    const n = toNumber(v);
    return n === null ? null : -n;
  },
  passes,
  equal,
  arith(op: string, a: Json, b: Json): Json {
    const x = toNumber(a),
      y = toNumber(b);
    if (x === null || y === null) return null;
    if ((op === "/" || op === "%") && y === 0) return null;
    const r = op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : x % y;
    if (!Number.isFinite(r)) throw new ValueError("the arithmetic result is not a finite number");
    return r;
  },
  cmp(op: string, a: Json, b: Json): boolean {
    const c = compare(a, b);
    if (c === null) return false;
    return op === "<" ? c < 0 : op === "<=" ? c <= 0 : op === ">" ? c > 0 : c >= 0;
  },
  isIn: (v: Json, list: Json) => (Array.isArray(list) ? list.some((x) => equal(v, x)) : false),
  call(name: string, args: (() => Json)[]): Json {
    const f = SCALARS[name];
    if (!f) throw new ValueError(`unknown function ${name}`);
    if (f.lazy) return f.lazy(args, { now: helpers.now });
    return f.run!(
      args.map((a) => a()),
      { now: helpers.now },
    );
  },
  agg(name: string, values: Json[]): Json {
    const a = AGGREGATES[name];
    if (!a) throw new ValueError(`unknown aggregate ${name}`);
    return a.reduce(values);
  },
  key: (v: Json) => keyOf(v),
  joinKey(values: Json[]): string | null {
    let k = "";
    for (const v of values) {
      if (v === null) return null;
      const t = typeof v === "number" ? numberText(v) : typeof v === "string" ? v : keyOf(v);
      k += t.length + ":" + t + "|";
    }
    return k;
  },
  sortKey(x: Json, y: Json, desc: boolean): number {
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const c = sortCompare(x, y);
    return desc ? -c : c;
  },
  lines(v: Json): Json[] {
    const items = (toText(v) ?? "").replace(/\r\n?/g, "\n").split("\n");
    if (items.at(-1) === "") items.pop();
    return items;
  },
  listOf(v: Json, col: string): Json[] {
    if (v === null) return [];
    if (Array.isArray(v)) return v;
    throw new ValueError(`"${col}" does not hold a list`);
  },
  text: toText,
  regex: (p: string) => safeRegex(p),
  matchFields(re: SafeRegex): [string, number][] {
    const named = re.groupNames.map((n, g) => [n, g] as const).filter(([n]) => n) as [string, number][];
    if (named.length) return named;
    if (re.groupCount) return Array.from({ length: re.groupCount }, (_, g) => [re.groupCount === 1 ? "match" : `match${g + 1}`, g + 1]);
    return [["match", 0]];
  },
};
