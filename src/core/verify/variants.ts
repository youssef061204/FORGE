/**
 * Host-made test inputs. Every candidate program runs on the real data and on
 * these variants; behavior across all of them is its fingerprint.
 */
import type { TableProfile } from "../profile";
import { toNumber } from "../recipe/values";
import type { Json, Row, Table } from "../table";

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Inputs = Record<string, Table>;
export type Variant = { id: string; label: string; inputs: Inputs };

const mapRows = (t: Table, f: (r: Row, i: number) => Row): Table => ({ columns: t.columns, rows: t.rows.map(f) });

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function numericColumns(t: Table): string[] {
  return t.columns.filter((c) => {
    let seen = 0;
    for (const r of t.rows.slice(0, 200)) {
      const v = r[c];
      if (v === null || v === "") continue;
      if (typeof v === "number") {
        seen++;
        continue;
      }
      if (typeof v !== "string") return false;
      try {
        if (toNumber(v) === null) continue;
        seen++;
      } catch {
        return false;
      }
    }
    return seen > 0;
  });
}

function textColumns(t: Table, numeric: string[]): string[] {
  return t.columns.filter((c) => !numeric.includes(c) && t.rows.some((r) => typeof r[c] === "string" && r[c] !== ""));
}

function negate(v: Json): Json {
  if (typeof v === "number") return v === 0 ? 0 : -v;
  if (typeof v === "string" && v.trim()) {
    const t = v.trim();
    return t.startsWith("-") ? t.slice(1) : "-" + t;
  }
  return v;
}

/** Apply a table transformation to every input (or just the first). */
function each(inputs: Inputs, f: (t: Table, slot: string) => Table, onlyFirst = false): Inputs {
  const slots = Object.keys(inputs);
  return Object.fromEntries(slots.map((s, i) => [s, onlyFirst && i > 0 ? inputs[s] : f(inputs[s], s)]));
}

export function makeVariants(inputs: Inputs, seed = 7): Variant[] {
  const random = rng(seed);
  const variants: Variant[] = [
    { id: "empty", label: "no rows", inputs: each(inputs, (t) => ({ columns: t.columns, rows: [] }), true) },
    { id: "one", label: "a single row", inputs: each(inputs, (t) => ({ columns: t.columns, rows: t.rows.slice(0, 1) }), true) },
    { id: "doubled", label: "every row twice", inputs: each(inputs, (t) => ({ columns: t.columns, rows: t.rows.flatMap((r) => [r, r]) }), true) },
    { id: "shuffled", label: "rows in a different order", inputs: each(inputs, (t) => ({ columns: t.columns, rows: shuffle(t.rows, random) })) },
  ];
  const first = Object.keys(inputs)[0];
  const t = inputs[first];
  const numeric = numericColumns(t);
  const text = textColumns(t, numeric);
  if (t.rows.length) {
    const col = t.columns[Math.floor(random() * t.columns.length)];
    variants.push({
      id: "blanks",
      label: `blank cells in ${col}`,
      inputs: { ...inputs, [first]: mapRows(t, (r, i) => (i % 2 === 1 ? { ...r, [col]: typeof r[col] === "string" ? "" : null } : r)) },
    });
  }
  if (text.length)
    variants.push({
      id: "punctuation",
      label: "commas, quotes and accents in text",
      inputs: {
        ...inputs,
        [first]: mapRows(t, (r, i) => {
          const o = { ...r };
          for (const c of text) if (typeof o[c] === "string" && o[c] !== "" && i % 2 === 0) o[c] = `${o[c]}, “é漢”`;
          return o;
        }),
      },
    });
  if (numeric.length)
    variants.push({
      id: "negative",
      label: "negative numbers",
      inputs: { ...inputs, [first]: mapRows(t, (r, i) => (i % 2 === 0 ? Object.fromEntries(Object.entries(r).map(([k, v]) => [k, numeric.includes(k) ? negate(v) : v])) : r)) },
    });
  return variants;
}

/** Seeded random tables shaped like the real ones (same columns, similar values). */
export function fuzzInputs(inputs: Inputs, count = 3, seed = 11): Variant[] {
  const out: Variant[] = [];
  for (let k = 0; k < count; k++) {
    const random = rng(seed + k * 101);
    const fuzzed: Inputs = {};
    for (const [slot, t] of Object.entries(inputs)) {
      const n = Math.min(12, Math.max(2, Math.floor(random() * 10) + 2));
      const pools = Object.fromEntries(t.columns.map((c) => [c, t.rows.map((r) => r[c] ?? null)]));
      const rows: Row[] = [];
      for (let i = 0; i < n; i++) {
        const r: Row = {};
        for (const c of t.columns) {
          const pool = pools[c];
          let v: Json = pool.length ? pool[Math.floor(random() * pool.length)] : null;
          if (typeof v === "number" && random() < 0.4) v = Math.round((v + (random() - 0.5) * 20) * 100) / 100;
          else if (typeof v === "string" && random() < 0.15) {
            try {
              const nv = toNumber(v);
              if (nv !== null) v = String(Math.round((nv + (random() - 0.3) * 30) * 100) / 100);
            } catch {
              /* text stays as sampled */
            }
          }
          r[c] = v;
        }
        rows.push(r);
      }
      fuzzed[slot] = { columns: t.columns, rows };
    }
    out.push({ id: `fuzz${k + 1}`, label: `random sample ${k + 1}`, inputs: fuzzed });
  }
  return out;
}

export function profileHint(profile: TableProfile) {
  return profile.columns.map((c) => c.name);
}
