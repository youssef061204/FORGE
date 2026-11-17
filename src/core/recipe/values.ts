/** Value semantics shared by the recipe evaluator and the IR extensions. */
import { isRecord, keyOf, type Json } from "../table";

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/**
 * Read a value as a number. Accepts numbers, numeric text with optional
 * surrounding space, a leading currency sign, thousands commas (1,200.50) and
 * a trailing percent sign (12% -> 12). Empty text and null become null.
 * Anything else is an error rather than a silent zero.
 */
export function toNumber(value: Json): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") throw new ValueError("a list or object cannot be read as a number");
  let t = value.trim();
  if (!t) return null;
  let sign = "";
  if (t[0] === "-" || t[0] === "+") {
    sign = t[0] === "-" ? "-" : "";
    t = t.slice(1).trim();
  }
  if (/^[$€£¥]/.test(t)) t = t.slice(1).trim();
  if (t.endsWith("%")) t = t.slice(0, -1).trim();
  if (t[0] === "-" && !sign) {
    sign = "-";
    t = t.slice(1);
  }
  if (GROUPED.test(t)) t = t.replaceAll(",", "");
  if (!NUMERIC.test(t)) throw new ValueError(`"${value.slice(0, 40)}" is not a number`);
  const n = Number(sign + t);
  if (!Number.isFinite(n)) throw new ValueError(`"${value.slice(0, 40)}" is too large`);
  return n;
}

export function toText(value: Json): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return numberText(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

export function numberText(n: number): string {
  if (Object.is(n, -0)) return "0";
  // Avoid binary noise such as 0.30000000000000004 in visible output.
  const rounded = Number(n.toPrecision(15));
  return String(rounded);
}

export function toBool(value: Json): boolean | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (["true", "yes", "y", "1", "t"].includes(t)) return true;
    if (["false", "no", "n", "0", "f", ""].includes(t)) return false;
    throw new ValueError(`"${value.slice(0, 40)}" is not true or false`);
  }
  throw new ValueError("a list or object cannot be read as true or false");
}

/** Truthiness for filters: only true passes; null and false drop the row. */
export function passes(value: Json): boolean {
  if (typeof value === "boolean") return value;
  if (value === null) return false;
  const b = toBool(value);
  return b === true;
}

export function equal(a: Json, b: Json): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "number" && typeof b === "string") {
    const n = safeNumber(b);
    return n !== undefined && n === a;
  }
  if (typeof b === "number" && typeof a === "string") return equal(b, a);
  if (typeof a === "boolean" && typeof b === "string") return safeBool(b) === a;
  if (typeof b === "boolean" && typeof a === "string") return safeBool(a) === b;
  return keyOf(a) === keyOf(b);
}

function safeNumber(v: string): number | undefined {
  try {
    const n = toNumber(v);
    return n === null ? undefined : n;
  } catch {
    return undefined;
  }
}
function safeBool(v: string): boolean | undefined {
  try {
    return toBool(v) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ordering. Numbers compare numerically; when one side is a number and the
 * other numeric text, the text is read as a number. Text compares by code
 * point, which also orders ISO dates correctly. Nulls are not comparable.
 */
export function compare(a: Json, b: Json): number | null {
  if (a === null || b === null) return null;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "number" || typeof b === "number") {
    const x = typeof a === "number" ? a : safeNumber(a as string);
    const y = typeof b === "number" ? b : safeNumber(b as string);
    if (x === undefined || y === undefined)
      throw new ValueError(`cannot compare ${describe(a)} with ${describe(b)}`);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  throw new ValueError(`cannot order ${describe(a)} against ${describe(b)}`);
}

/** Total order for sorting: nulls last, then numbers, then text, then others. */
export function sortCompare(a: Json, b: Json): number {
  const rank = (v: Json) =>
    v === null ? 4 : typeof v === "number" ? 0 : typeof v === "string" ? 1 : typeof v === "boolean" ? 2 : 3;
  const ra = rank(a),
    rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 0) return (a as number) - (b as number);
  if (ra === 1) return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  if (ra === 2) return Number(a) - Number(b);
  if (ra === 3) {
    const x = keyOf(a),
      y = keyOf(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return 0;
}

export function describe(v: Json): string {
  if (v === null) return "nothing";
  if (typeof v === "string") return `"${v.slice(0, 30)}"`;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  return Array.isArray(v) ? "a list" : "an object";
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const SLASH_US = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Calendar date as days since 1970-01-01 (UTC), from ISO-like text. */
export function toDay(value: Json): number | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new ValueError(`${describe(value)} is not a date`);
  const t = value.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  const iso = ISO.exec(t);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const us = SLASH_US.exec(t);
    if (!us) throw new ValueError(`"${t.slice(0, 40)}" is not a YYYY-MM-DD date`);
    [m, d, y] = [Number(us[1]), Number(us[2]), Number(us[3])];
  }
  const ms = Date.UTC(y, m - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d)
    throw new ValueError(`"${t.slice(0, 40)}" is not a real calendar date`);
  return Math.round(ms / 86400000);
}

export function dayText(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

export function asList(value: Json): Json[] {
  if (value === null) return [];
  if (Array.isArray(value)) return value;
  throw new ValueError(`${describe(value)} is not a list`);
}

export { isRecord };
