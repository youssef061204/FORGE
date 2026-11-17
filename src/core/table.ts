/** The data model every layer shares: JSON values arranged in tables. */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type Row = Record<string, Json>;
export type Table = { columns: string[]; rows: Row[] };

export const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function isRecord(value: unknown): value is Record<string, Json> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Stable structural key for equality, grouping and fingerprints. */
export function keyOf(value: Json | undefined): string {
  if (value === undefined) return "u";
  if (value === null) return "n";
  if (typeof value === "number") return "d" + (Object.is(value, -0) ? 0 : value);
  if (typeof value === "string") return "s" + value.length + ":" + value;
  if (typeof value === "boolean") return value ? "t" : "f";
  if (Array.isArray(value)) return "[" + value.map(keyOf).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + keyOf(value[k]))
      .join(",") +
    "}"
  );
}

export function columnsOf(rows: Row[]): string[] {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows)
    for (const key of Object.keys(row))
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
  return columns;
}

/** Deterministic 32-bit FNV-1a hash rendered as hex; isomorphic. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
