/** Column type inference and statistics. No model involved. */
import type { ColumnInfo } from "../recipe/engine";
import type { ValueType } from "../recipe/functions";
import { toDay, toNumber } from "../recipe/values";
import { keyOf, type Json, type Table } from "../table";

export type Kind = "number" | "integer" | "date" | "boolean" | "text" | "empty" | "list" | "object" | "mixed";

export type ColumnProfile = {
  name: string;
  /** What the values look like (CSV cells are text that may look numeric). */
  kind: Kind;
  /** How the values are stored. */
  storage: ValueType;
  nulls: number;
  distinct: number;
  samples: Json[];
  min?: Json;
  max?: Json;
  /** For JSON objects: nested field names, so the model can write a.b paths. */
  fields?: string[];
};

export type TableProfile = { rows: number; columns: ColumnProfile[] };

const SAMPLE = 2000;

function looksBool(s: string) {
  return /^(true|false|yes|no)$/i.test(s.trim());
}

function kindOf(v: Json): Kind {
  if (v === null) return "empty";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "boolean") return "boolean";
  if (Array.isArray(v)) return "list";
  if (typeof v === "object") return "object";
  const t = v.trim();
  if (!t) return "empty";
  try {
    const n = toNumber(t);
    if (n !== null && /^[+-]?[\d.,]+%?$|^[$€£¥]/.test(t)) return Number.isInteger(n) && !t.includes(".") ? "integer" : "number";
  } catch {
    /* not numeric */
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    try {
      toDay(t.slice(0, 10));
      return "date";
    } catch {
      /* not a date */
    }
  }
  if (looksBool(t)) return "boolean";
  return "text";
}

function storageOf(v: Json): ValueType {
  if (v === null) return "any";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "string") return "text";
  return Array.isArray(v) ? "list" : "object";
}

export function profileTable(table: Table): TableProfile {
  const rows = table.rows;
  const sample = rows.length > SAMPLE ? rows.filter((_, i) => i % Math.ceil(rows.length / SAMPLE) === 0) : rows;
  const columns = table.columns.map((name): ColumnProfile => {
    const kinds = new Map<Kind, number>();
    const storages = new Set<ValueType>();
    const distinct = new Set<string>();
    const samples: Json[] = [];
    let nulls = 0;
    let min: Json | undefined, max: Json | undefined;
    const fields = new Set<string>();
    for (const r of sample) {
      const v = Object.hasOwn(r, name) ? r[name] : null;
      const k = kindOf(v);
      if (k === "empty") {
        nulls++;
        continue;
      }
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
      storages.add(storageOf(v));
      if (distinct.size < 10000) distinct.add(keyOf(v));
      if (samples.length < 4 && !samples.some((s) => keyOf(s) === keyOf(v))) samples.push(v);
      if (k === "object" && v && typeof v === "object" && !Array.isArray(v)) Object.keys(v).forEach((f) => fields.size < 30 && fields.add(f));
      if (k === "number" || k === "integer") {
        const n = toNumber(v);
        if (n !== null) {
          if (min === undefined || n < (min as number)) min = n;
          if (max === undefined || n > (max as number)) max = n;
        }
      } else if (k === "date" && typeof v === "string") {
        if (min === undefined || v < (min as string)) min = v;
        if (max === undefined || v > (max as string)) max = v;
      }
    }
    let kind: Kind = "empty";
    if (kinds.size === 1) kind = [...kinds.keys()][0];
    else if (kinds.size === 2 && kinds.has("integer") && kinds.has("number")) kind = "number";
    else if (kinds.size > 1) kind = "mixed";
    const storage: ValueType = storages.size === 1 ? [...storages][0] : "any";
    return {
      name,
      kind,
      storage,
      nulls: Math.round((nulls * rows.length) / Math.max(1, sample.length)),
      distinct: distinct.size,
      samples,
      ...(min !== undefined ? { min, max } : {}),
      ...(fields.size ? { fields: [...fields] } : {}),
    };
  });
  return { rows: rows.length, columns };
}

export function schemaOf(profile: TableProfile): ColumnInfo[] {
  return profile.columns.map((c) => ({ name: c.name, type: c.storage }));
}
