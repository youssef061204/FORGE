/**
 * Emit a recipe as straightforward TypeScript: explicit loops, maps and sorts.
 * It shares only the value semantics (values.ts, functions.ts) with the
 * interpreter, not its step machinery, so running both on the same inputs is
 * a real translation check. The same text, with the helpers bundled, is what
 * "eject" downloads.
 */
import { parseExpr, type Expr } from "./expr";
import { lookup, resolveName } from "./functions";
import { parseSortKey } from "./engine";
import type { Recipe, Step } from "./schema";

const S = JSON.stringify;

type Ctx = { aggregate: boolean; rowsVar: string };

function expr(e: Expr, ctx: Ctx): string {
  switch (e.k) {
    case "lit":
      return S(e.v);
    case "col":
      return ctx.aggregate ? `H.col(${ctx.rowsVar}[0] ?? {}, ${S(e.path)})` : `H.col(r, ${S(e.path)})`;
    case "list":
      return `[${e.items.map((i) => expr(i, ctx)).join(", ")}]`;
    case "neg":
      return `H.neg(${expr(e.arg, ctx)})`;
    case "not":
      return `!H.passes(${expr(e.arg, ctx)})`;
    case "bin": {
      const l = expr(e.l, ctx),
        r = expr(e.r, ctx);
      switch (e.op) {
        case "+":
        case "-":
        case "*":
        case "/":
        case "%":
          return `H.arith(${S(e.op)}, ${l}, ${r})`;
        case "==":
          return `H.equal(${l}, ${r})`;
        case "!=":
          return `!H.equal(${l}, ${r})`;
        case "and":
          return `(H.passes(${l}) && H.passes(${r}))`;
        case "or":
          return `(H.passes(${l}) || H.passes(${r}))`;
        case "in":
          return `H.isIn(${l}, ${r})`;
        default:
          return `H.cmp(${S(e.op)}, ${l}, ${r})`;
      }
    }
    case "call": {
      const found = lookup(e.fn, e.args.length, ctx.aggregate);
      const name = found?.name ?? resolveName(e.fn);
      if (found?.fn.kind === "aggregate") {
        const inner: Ctx = { aggregate: false, rowsVar: ctx.rowsVar };
        // Inside a derive/filter an aggregate means the whole table.
        const rows = ctx.aggregate ? ctx.rowsVar : "T";
        if (!e.args.length) return `${rows}.length`;
        const values = `${rows}.map((r) => ${expr(e.args[0], inner)})`;
        if (name === "count") return `${values}.filter((v) => v !== null).length`;
        return `H.agg(${S(name)}, ${values})`;
      }
      const args = e.args.map((a) => `() => ${expr(a, ctx)}`);
      return `H.call(${S(name)}, [${args.join(", ")}])`;
    }
  }
}

function e(source: string, aggregate = false, rowsVar = "g") {
  return expr(parseExpr(source), { aggregate, rowsVar });
}

function step(s: Step, i: number, src: string, out: string): string {
  const lines: string[] = [];
  const L = (x: string) => lines.push("  " + x);
  L(`// step ${i + 1}: ${s.op}`);
  L(`const T${i} = ${src}; const T = T${i};`);
  switch (s.op) {
    case "filter":
      L(`const ${out}: Row[] = []; for (const r of T) if (H.passes(${e(s.where)})) ${out}.push(r);`);
      break;
    case "derive":
      L(`const ${out}: Row[] = [];`);
      L(`for (const r0 of T) { const r: Row = { ...r0 };`);
      for (const [col, x] of Object.entries(s.set)) L(`  r[${S(col)}] = ${e(x)};`);
      L(`  ${out}.push(r); }`);
      break;
    case "select":
      L(`const ${out} = T.map((r) => ({ ${s.columns.map((c) => `${S(c)}: H.own(r, ${S(c)})`).join(", ")} }));`);
      break;
    case "drop":
      L(`const ${out} = T.map((r) => { const o: Row = { ...r }; ${s.columns.map((c) => `delete o[${S(c)}];`).join(" ")} return o; });`);
      break;
    case "rename":
      L(`const ${out} = T.map((r) => { const o: Row = {}; for (const k of Object.keys(r)) o[(${S(s.map)} as Record<string, string>)[k] ?? k] = r[k]; return o; });`);
      break;
    case "sort": {
      const keys = s.by.map((b) => parseSortKey(b));
      L(`const dec = T.map((r, i) => ({ r, i, k: [${keys.map((k) => e(k.expr)).join(", ")}] }));`);
      L(`dec.sort((a, b) => { ${keys.map((k, j) => `{ const c = H.sortKey(a.k[${j}], b.k[${j}], ${k.desc}); if (c) return c; }`).join(" ")} return a.i - b.i; });`);
      L(`const ${out} = dec.map((d) => d.r);`);
      break;
    }
    case "dedupe": {
      const by = s.by?.length ? `H.key([${s.by.map((b) => e(b)).join(", ")}])` : "H.key(r)";
      L(`const keys = T.map((r) => ${by});`);
      L(`const pick = new Map<string, number>(); keys.forEach((k, i) => { if (${s.keep === "last"} || !pick.has(k)) pick.set(k, i); });`);
      L(`const ${out} = T.filter((_, i) => pick.get(keys[i]) === i);`);
      break;
    }
    case "summarize": {
      const by = s.by ?? [];
      L(`const groups = new Map<string, Row[]>();`);
      if (by.length) L(`for (const r of T) { const k = H.key([${by.map((c) => `H.own(r, ${S(c)})`).join(", ")}]); const list = groups.get(k); if (list) list.push(r); else groups.set(k, [r]); }`);
      else L(`groups.set("", T);`);
      L(`const ${out}: Row[] = [];`);
      L(`for (const g of groups.values()) { const o: Row = {};`);
      for (const c of by) L(`  o[${S(c)}] = H.own(g[0], ${S(c)});`);
      for (const [col, x] of Object.entries(s.set)) L(`  o[${S(col)}] = ${e(x, true, "g")};`);
      L(`  ${out}.push(o); }`);
      break;
    }
    case "join": {
      const pairs: [string, string][] = Array.isArray(s.on) ? s.on.map((c) => [c, c]) : Object.entries(s.on);
      const kind = s.kind ?? "inner";
      L(`const R = tables[${S(s.with)}];`);
      L(`const idx = new Map<string, Row[]>(); for (const rr of R) { const k = H.joinKey([${pairs.map(([, r]) => `H.own(rr, ${S(r)})`).join(", ")}]); if (k === null) continue; const l = idx.get(k); if (l) l.push(rr); else idx.set(k, [rr]); }`);
      L(`const leftCols = new Set(columns(T, cols[${S(src)}]));`);
      L(`const extra = columns(R, cols[${S(s.with)}]).filter((c) => !${S(pairs.map(([, r]) => r))}.includes(c)).map((c) => [c, leftCols.has(c) ? ${S(s.with + ".")} + c : c]);`);
      L(`const ${out}: Row[] = [];`);
      L(`for (const r of T) { const k = H.joinKey([${pairs.map(([l]) => `H.own(r, ${S(l)})`).join(", ")}]); const m = k === null ? undefined : idx.get(k);`);
      if (kind === "anti") L(`  if (!m) ${out}.push(r); }`);
      else if (kind === "semi") L(`  if (m) ${out}.push(r); }`);
      else {
        L(`  if (!m) { ${kind === "left" ? `const o: Row = { ...r }; for (const [, to] of extra) o[to] = null; ${out}.push(o);` : ""} continue; }`);
        L(`  for (const rr of m) { const o: Row = { ...r }; for (const [from, to] of extra) o[to] = H.own(rr, from); ${out}.push(o); } }`);
      }
      break;
    }
    case "unnest":
    case "lines": {
      const into = s.into ?? s.column;
      L(`const ${out}: Row[] = [];`);
      L(`for (const r of T) { const v = H.own(r, ${S(s.column)});`);
      if (s.op === "lines") L(`  const items = H.lines(v);`);
      else L(`  const items = H.listOf(v, ${S(s.column)});`);
      L(`  for (const item of items) ${out}.push({ ...r, [${S(into)}]: item }); }`);
      break;
    }
    case "match":
      L(`const re = H.regex(${S(s.pattern)}); const fields = H.matchFields(re);`);
      L(`const ${out}: Row[] = [];`);
      L(`for (const r of T) { const v = H.text(H.own(r, ${S(s.column)})); const m = v === null ? null : re.exec(v);`);
      L(`  if (!m && ${s.keep !== "all"}) continue; const o: Row = { ...r }; for (const [n] of fields) delete o[n]; for (const [n, g] of fields) o[n] = m ? (m.groups[g] ?? null) : null; ${out}.push(o); }`);
      break;
    case "limit":
      L(`const ${out} = T.slice(${s.offset ?? 0}, ${(s.offset ?? 0) + s.n});`);
      break;
    case "union":
      L(`const ${out} = [...T, ...tables[${S(s.with)}]];`);
      break;
  }
  return lines.join("\n");
}

/** The column order after a step, as a TypeScript expression over the source's columns. */
function columnsAfter(s: Step, src: string): string {
  switch (s.op) {
    case "select":
      return S(s.columns);
    case "drop":
      return `${src}.filter((c) => !${S(s.columns)}.includes(c))`;
    case "rename":
      return `${src}.map((c) => (${S(s.map)} as Record<string, string>)[c] ?? c)`;
    case "derive": {
      const added = Object.keys(s.set);
      return `[...${src}, ...${S(added)}.filter((c, i, all) => !${src}.includes(c) && all.indexOf(c) === i)]`;
    }
    case "summarize":
      return S([...(s.by ?? []), ...Object.keys(s.set)]);
    case "join": {
      if (s.kind === "anti" || s.kind === "semi") return src;
      const rightKeys = Array.isArray(s.on) ? s.on : Object.values(s.on);
      return `[...${src}, ...cols[${S(s.with)}].filter((c) => !${S(rightKeys)}.includes(c)).map((c) => (${src}.includes(c) ? ${S(s.with + ".")} + c : c))]`;
    }
    case "unnest":
    case "lines": {
      const into = s.into ?? s.column;
      return `(${src}.includes(${S(into)}) ? ${src} : [...${src}, ${S(into)}])`;
    }
    case "match":
      return `((F) => [...${src}.filter((c) => !F.includes(c)), ...F])(H.matchFields(H.regex(${S(s.pattern)})).map((f: [string, number]) => f[0]))`;
    case "union":
      return `[...${src}, ...cols[${S(s.with)}].filter((c) => !${src}.includes(c))]`;
    default:
      return src;
  }
}

/**
 * The emitted module exports run(tables, cols, H) returning the final tables
 * by name. `cols` gives each input's column order; H is the helper object.
 */
export function emitTypeScript(recipe: Recipe): string {
  const out: string[] = [];
  out.push("// Emitted by FORGE from a recipe. Plain TypeScript: no network, no files, no eval.");
  out.push("type Json = null | boolean | number | string | Json[] | { [k: string]: Json };");
  out.push("type Row = Record<string, Json>;");
  out.push("function columns(rows: Row[], given?: string[]): string[] { const s = new Set<string>(given ?? []); for (const r of rows) for (const k of Object.keys(r)) s.add(k); return [...s]; }");
  out.push("export function run(tables: Record<string, Row[]>, cols: Record<string, string[]>, H: any): Record<string, Row[]> {");
  let current = recipe.inputs[0].slot;
  const names = new Map<string, string>();
  recipe.inputs.forEach((i) => names.set(i.slot, `tables[${S(i.slot)}]`));
  recipe.steps.forEach((s, i) => {
    const src = s.from ?? current;
    const target = s.as ?? `step${i + 1}`;
    const v = `S${i}`;
    // Each step is its own block, so step-local names never collide.
    out.push("  {");
    out.push(step(s, i, names.get(src) ?? `tables[${S(src)}]`, v));
    out.push(`  tables[${S(target)}] = ${v};`);
    out.push(`  cols[${S(target)}] = ${columnsAfter(s, `cols[${S(src)}]`)};`);
    out.push("  }");
    names.set(target, `tables[${S(target)}]`);
    current = target;
  });
  out.push(`  tables.__final = tables[${S(current)}];`);
  out.push("  return tables;");
  out.push("}");
  return out.join("\n");
}
