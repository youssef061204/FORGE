import { describe, expect, it } from "vitest";
import { decode, formatFromName } from "../../src/core/codec";
import { compileRecipe, runPlan } from "../../src/core/recipe/engine";
import { RecipeError } from "../../src/core/recipe/diagnostics";
import { recipeSchema, type Recipe } from "../../src/core/recipe/schema";
import { profileTable, schemaOf } from "../../src/core/profile";
import type { Table } from "../../src/core/table";

function load(files: Record<string, string>) {
  const tables: Record<string, Table> = {};
  for (const [slot, text] of Object.entries(files)) {
    const [name, body] = text.split("\n---\n");
    tables[slot] = decode(body, formatFromName(name)!).table;
  }
  return tables;
}
function run(recipe: Recipe, files: Record<string, string>) {
  const tables = load(files);
  const schemas = Object.fromEntries(Object.entries(tables).map(([k, t]) => [k, schemaOf(profileTable(t))]));
  const plan = compileRecipe(recipeSchema.parse(recipe), schemas);
  return runPlan(plan, tables, { instrument: true });
}
const csvRows = (text: string) => text.trimEnd().split("\n").map((l) => l.split(","));

describe("recipe engine on hand-written recipes", () => {
  it("totals sales by item and renders lineage", () => {
    const out = run(
      {
        inputs: [{ slot: "orders", format: "csv" }],
        steps: [
          { op: "derive", set: { total: "num(quantity) * num(price)" } },
          { op: "summarize", by: ["item"], set: { total: "sum(total)" } },
        ],
        outputs: [{ kind: "file", name: "totals.json", format: "json", shape: { map: { key: "item", value: "total" } } }],
      },
      { orders: "orders.csv\n---\nitem,quantity,price\npen,2,1.5\ncup,1,4\npen,3,1.5\n" },
    );
    const file = out.outputs[0];
    expect(file.kind === "file" && file.value).toEqual({ pen: 7.5, cup: 4 });
    expect(out.snapshots![1].sampleLineage).toEqual([[0, 2], [1]]);
  });

  it("filters, keeps order and columns", () => {
    const out = run(
      {
        inputs: [{ slot: "tasks" }],
        steps: [{ op: "filter", where: "status != 'done'" }],
        outputs: [{ kind: "file", name: "active-tasks.csv", format: "csv" }],
      },
      { tasks: "tasks.csv\n---\nid,task,status,priority\nT1,Review notes,open,high\nT2,Send report,done,low\nT3,Book room,waiting,medium\n" },
    );
    expect(out.outputs[0].kind === "file" && csvRows(out.outputs[0].text)).toEqual([
      ["id", "task", "status", "priority"],
      ["T1", "Review notes", "open", "high"],
      ["T3", "Book room", "waiting", "medium"],
    ]);
  });

  it("sorts by a numeric reading of text without changing it", () => {
    const out = run(
      {
        inputs: [{ slot: "invoices" }],
        steps: [
          { op: "filter", where: "status == 'unpaid'" },
          { op: "sort", by: ["num(amount) desc"] },
        ],
        outputs: [{ kind: "file", name: "unpaid.csv", format: "csv" }],
      },
      { invoices: 'invoices.csv\n---\ninvoice,customer,amount,status\nI1,Maple,20,unpaid\nI2,"Bay, Inc.",150,unpaid\nI3,Cedar,300,paid\nI4,Spruce,9.50,unpaid\n' },
    );
    const f = out.outputs[0];
    expect(f.kind === "file" && f.text).toBe('invoice,customer,amount,status\nI2,"Bay, Inc.",150,unpaid\nI1,Maple,20,unpaid\nI4,Spruce,9.50,unpaid\n');
  });

  it("dedupes by a normalized key and keeps the first name", () => {
    const out = run(
      {
        inputs: [{ slot: "contacts" }],
        steps: [
          { op: "derive", set: { email: "lower(trim(email))" } },
          { op: "dedupe", by: ["email"] },
          { op: "select", columns: ["name", "email"] },
        ],
        outputs: [{ kind: "file", name: "clean.csv", format: "csv" }],
      },
      { contacts: "contacts.csv\n---\nname,email\nMira, MIRA@example.test \nOther,mira@example.test\nNoah,noah@example.test\n" },
    );
    expect(out.outputs[0].kind === "file" && out.outputs[0].text).toBe("name,email\nMira,mira@example.test\nNoah,noah@example.test\n");
  });

  it("joins two inputs with a hash join", () => {
    const out = run(
      {
        inputs: [{ slot: "people" }, { slot: "attendance" }],
        steps: [
          { op: "join", with: "attendance", on: ["id"] },
          { op: "filter", where: "reply == 'yes'" },
          { op: "select", columns: ["name", "email"] },
        ],
        outputs: [{ kind: "file", name: "attendees.csv", format: "csv" }],
      },
      {
        people: "people.csv\n---\nid,name,email\nU1,Ada,ada@example.test\nU2,Eli,eli@example.test\nU3,Sam,sam@example.test\n",
        attendance: "attendance.csv\n---\nid,reply\nU3,yes\nU1,yes\nU2,no\nU9,yes\n",
      },
    );
    expect(out.outputs[0].kind === "file" && out.outputs[0].text).toBe("name,email\nAda,ada@example.test\nSam,sam@example.test\n");
  });

  it("flattens nested JSON with dotted paths", () => {
    const out = run(
      {
        inputs: [{ slot: "catalog" }],
        steps: [
          { op: "derive", set: { price: "pricing.price", available: "text(stock.available)" } },
          { op: "select", columns: ["sku", "name", "price", "available"] },
        ],
        outputs: [{ kind: "file", name: "catalog.csv", format: "csv" }],
      },
      { catalog: 'catalog.json\n---\n{"products":[{"sku":"B1","name":"Notebook","pricing":{"price":4.5},"stock":{"available":true}},{"sku":"B2","name":"Pencil","pricing":{"price":1},"stock":{"available":false}}]}' },
    );
    expect(out.outputs[0].kind === "file" && out.outputs[0].text).toBe("sku,name,price,available\nB1,Notebook,4.5,true\nB2,Pencil,1,false\n");
  });

  it("summarizes everything into one object", () => {
    const out = run(
      {
        inputs: [{ slot: "sessions" }],
        steps: [
          { op: "filter", where: "not completed" },
          { op: "summarize", set: { remainingMinutes: "sum(minutes)", count: "count()" } },
        ],
        outputs: [{ kind: "file", name: "remaining.json", format: "json", shape: "row" }],
      },
      { sessions: 'sessions.json\n---\n{"sessions":[{"title":"Math","minutes":45,"completed":false},{"title":"History","minutes":30,"completed":true},{"title":"Physics","minutes":20,"completed":false}]}' },
    );
    expect(out.outputs[0].kind === "file" && out.outputs[0].value).toEqual({ remainingMinutes: 65, count: 2 });
  });

  it("ranks with a tie-break and writes a list", () => {
    const out = run(
      {
        inputs: [{ slot: "applicants" }],
        steps: [{ op: "sort", by: ["score desc", "name"] }],
        outputs: [{ kind: "file", name: "ranking.json", format: "json", shape: { values: "name" } }],
      },
      { applicants: 'applicants.json\n---\n{"applicants":[{"name":"Zoe","score":88},{"name":"Amir","score":91},{"name":"Bea","score":88},{"name":"Luis","score":76}]}' },
    );
    expect(out.outputs[0].kind === "file" && out.outputs[0].value).toEqual(["Amir", "Bea", "Zoe", "Luis"]);
  });

  it("extracts text lines with a pattern", () => {
    const out = run(
      {
        inputs: [{ slot: "notes" }],
        steps: [
          { op: "match", column: "line", pattern: "^TODO:\\s*(?<task>.*?)\\s*$" },
          { op: "select", columns: ["task"] },
        ],
        outputs: [{ kind: "file", name: "todos.json", format: "json", shape: { values: "task" } }],
      },
      { notes: "notes.txt\n---\nMeeting notes\nTODO: Send agenda\nCompleted: Book room\nTODO:  Review draft  \nTODO: Prepare slides\n" },
    );
    expect(out.outputs[0].kind === "file" && out.outputs[0].value).toEqual(["Send agenda", "Review draft", "Prepare slides"]);
  });

  it("normalizes a text list", () => {
    const out = run(
      {
        inputs: [{ slot: "names" }],
        steps: [
          { op: "derive", set: { line: "lower(trim(line))" } },
          { op: "filter", where: "line != ''" },
          { op: "dedupe", by: ["line"] },
          { op: "sort", by: ["line"] },
        ],
        outputs: [{ kind: "file", name: "names-clean.txt", format: "text", shape: { values: "line" } }],
      },
      { names: "names.txt\n---\n  Maple\nCEDAR\n\nmaple\n Birch \ncedar\n" },
    );
    expect(out.outputs[0].kind === "file" && out.outputs[0].text).toBe("birch\ncedar\nmaple\n");
  });

  it("counts by category and keeps date windows inclusive", () => {
    const counts = run(
      {
        inputs: [{ slot: "tickets" }],
        steps: [{ op: "summarize", by: ["status"], set: { n: "count()" } }],
        outputs: [{ kind: "file", name: "counts.json", format: "json", shape: { map: { key: "status", value: "n" } } }],
      },
      { tickets: "tickets.csv\n---\nid,status\nA,open\nB,closed\nC,open\nD,pending\nE,closed\nF,open\n" },
    );
    expect(counts.outputs[0].kind === "file" && counts.outputs[0].value).toEqual({ open: 3, closed: 2, pending: 1 });
    const window = run(
      {
        inputs: [{ slot: "events" }],
        steps: [{ op: "filter", where: "date >= '2026-10-10' and date <= '2026-10-20'" }],
        outputs: [{ kind: "file", name: "oct.csv", format: "csv" }],
      },
      { events: "events.csv\n---\nname,date\nEarly,2026-10-09\nStart,2026-10-10\nMiddle,2026-10-15\nEnd,2026-10-20\nLate,2026-10-21\n" },
    );
    expect(window.outputs[0].kind === "file" && window.outputs[0].text).toBe("name,date\nStart,2026-10-10\nMiddle,2026-10-15\nEnd,2026-10-20\n");
  });

  it("reports located diagnostics with suggestions", () => {
    try {
      run(
        {
          inputs: [{ slot: "orders" }],
          steps: [{ op: "derive", set: { total: "num(quantty) * num(price)" } }],
          outputs: [{ kind: "file", name: "x.csv", format: "csv" }],
        },
        { orders: "orders.csv\n---\nitem,quantity,price\npen,2,1.5\n" },
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RecipeError);
      const d = (error as RecipeError).diagnostics[0];
      expect(d).toMatchObject({ code: "UNKNOWN_COLUMN", step: 0, hint: "did you mean quantity?", at: 4 });
    }
  });

  it("rejects aggregates outside summarize and ungrouped columns", () => {
    const files = { t: "t.csv\n---\na,b\n1,2\n" };
    expect(() =>
      run({ inputs: [{ slot: "t" }], steps: [{ op: "derive", set: { s: "sum(a)" } }], outputs: [{ kind: "file", name: "x.csv", format: "csv" }] }, files),
    ).toThrow(/only works inside a summarize/);
    expect(() =>
      run({ inputs: [{ slot: "t" }], steps: [{ op: "summarize", by: ["a"], set: { s: "b" } }], outputs: [{ kind: "file", name: "x.csv", format: "csv" }] }, files),
    ).toThrow(/differs between rows/);
  });
});
