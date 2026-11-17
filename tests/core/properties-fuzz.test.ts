import { describe, expect, it } from "vitest";
import { encodeDelimited, parseDelimited } from "../../src/core/codec/csv";
import { parseExpr, printExpr, sameExpr } from "../../src/core/recipe/expr";
import { compileRecipe, runPlan } from "../../src/core/recipe/engine";
import { recipeSchema } from "../../src/core/recipe/schema";
import { SafeRegex } from "../../src/core/recipe/regex";
import { rng } from "../../src/core/verify/variants";

/** Random expressions from the grammar, for parse/print round trips. */
function randomExpr(r: () => number, depth = 0): string {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  if (depth > 3 || r() < 0.3)
    return pick([
      () => String(Math.floor(r() * 1000) / (r() < 0.5 ? 1 : 10)),
      () => `'${pick(["a", "it's", "x\\y", "tab\t", "é漢", ""])}'`.replace("it's", "it\\'s"),
      () => pick(["amount", "name", "`odd name`", "pricing.price", "true", "null"]),
    ])();
  return pick([
    () => `${randomExpr(r, depth + 1)} ${pick(["+", "-", "*", "/", "==", "!=", "<", ">=", "and", "or"])} ${randomExpr(r, depth + 1)}`,
    () => `not ${randomExpr(r, depth + 1)}`,
    () => `-${randomExpr(r, depth + 1)}`,
    () => `(${randomExpr(r, depth + 1)})`,
    () => `${pick(["lower", "trim", "num", "len"])}(${randomExpr(r, depth + 1)})`,
    () => `concat(${randomExpr(r, depth + 1)}, ${randomExpr(r, depth + 1)})`,
    () => `${randomExpr(r, depth + 1)} in [${randomExpr(r, depth + 1)}, 'b']`,
  ])();
}

describe("property-based checks", () => {
  it("parse(print(parse(x))) equals parse(x) for 2,000 random expressions", () => {
    const r = rng(42);
    for (let i = 0; i < 2000; i++) {
      const src = randomExpr(r);
      const a = parseExpr(src);
      const printed = printExpr(a);
      const b = parseExpr(printed);
      expect(sameExpr(a, b), `${src}  →  ${printed}`).toBe(true);
    }
  });

  it("CSV encode then parse returns the same cells for 500 random tables", () => {
    const r = rng(7);
    const alphabet = ["a", "Z", " ", ",", '"', "\n", "\r\n", "é", "漢", "0", "-", "\t", "'"];
    for (let t = 0; t < 500; t++) {
      const cols = Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => `c${i}`);
      const rows = Array.from({ length: Math.floor(r() * 6) }, () =>
        cols.map(() => Array.from({ length: Math.floor(r() * 6) }, () => alphabet[Math.floor(r() * alphabet.length)]).join("")),
      );
      const text = encodeDelimited(cols, rows);
      const back = parseDelimited(text);
      expect(back.columns).toEqual(cols);
      // A row of one empty cell is indistinguishable from a blank line in CSV.
      const expected = rows.filter((row) => !(row.length === 1 && row[0] === ""));
      expect(back.rows).toEqual(expected);
    }
  });

  it("the regex engine agrees with JavaScript on simple patterns", () => {
    const cases: [string, string][] = [
      ["^TODO:\\s*(.*)$", "TODO:  fix it"],
      ["(\\d+)-(\\d+)", "call 555-0101 now"],
      ["a|ab|abc", "abcd"],
      ["(?<y>\\d{4})-(?<m>\\d{2})", "on 2026-11-17"],
      ["colou?r", "the color red"],
      ["[^aeiou ]+", "queue  rhythm"],
      ["\\bcat\\b", "concatenate cat"],
      ["x*?y", "xxxy"],
    ];
    for (const [p, s] of cases) {
      const ours = new SafeRegex(p).exec(s);
      const js = new RegExp(p).exec(s);
      expect(ours?.groups[0], p).toBe(js?.[0]);
      expect(ours?.index, p).toBe(js?.index);
      for (let g = 1; js && g < js.length; g++) expect(ours?.groups[g], `${p} group ${g}`).toBe(js[g]);
    }
  });

  it("groups and hash-joins 100,000 rows in under a second", () => {
    const n = 100_000;
    const orders = { columns: ["id", "customer", "amount"], rows: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, customer: `c${i % 5000}`, amount: String((i % 97) + 0.5) })) };
    const customers = { columns: ["customer", "region"], rows: Array.from({ length: 5000 }, (_, i) => ({ customer: `c${i}`, region: `r${i % 12}` })) };
    const recipe = recipeSchema.parse({
      inputs: [{ slot: "orders" }, { slot: "customers" }],
      steps: [
        { op: "join", with: "customers", on: ["customer"] },
        { op: "summarize", by: ["region"], set: { total: "sum(num(amount))", orders: "count()" } },
        { op: "sort", by: ["total desc"] },
      ],
      outputs: [{ kind: "file", name: "regions.csv", format: "csv" }],
    });
    const plan = compileRecipe(recipe, {
      orders: orders.columns.map((name) => ({ name, type: "text" as const })),
      customers: customers.columns.map((name) => ({ name, type: "text" as const })),
    });
    const t0 = performance.now();
    const out = runPlan(plan, { orders, customers });
    const ms = performance.now() - t0;
    expect(out.outputs[0].kind === "file" && out.outputs[0].table.rows.length).toBe(12);
    expect(ms, `${ms.toFixed(0)} ms`).toBeLessThan(1000);
  });
});
