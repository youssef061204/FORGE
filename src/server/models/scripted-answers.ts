/**
 * Deterministic answers for the scripted stand-in (tests and CI without a
 * GPU). Builds that use these are labeled SCRIPTED everywhere, never LIVE.
 * A list of recipes is cycled by draft seed, so drafts can disagree on purpose.
 */
import type { Recipe } from "../../core/recipe/schema";

type Answer = { match: RegExp; intent: Record<string, unknown>; recipe?: Recipe; recipes?: Recipe[] };

const totals: Recipe = {
  inputs: [{ slot: "orders", format: "csv" }],
  steps: [
    { op: "derive", set: { total: "num(quantity) * num(price)" } },
    { op: "summarize", by: ["item"], set: { total: "round(sum(total), 2)" } },
  ],
  outputs: [
    { kind: "file", name: "totals.json", format: "json", shape: { map: { key: "item", value: "total" } } },
    { kind: "view", type: "bar", x: "item", y: "total" },
  ],
};
// A wrong draft: forgets the price, so it agrees with nobody.
const totalsWrong: Recipe = {
  inputs: [{ slot: "orders", format: "csv" }],
  steps: [{ op: "summarize", by: ["item"], set: { total: "sum(quantity)" } }],
  outputs: [{ kind: "file", name: "totals.json", format: "json", shape: { map: { key: "item", value: "total" } } }],
};
const dedupe: Recipe = {
  inputs: [{ slot: "contacts", format: "csv" }],
  steps: [
    { op: "derive", set: { email: "lower(trim(email))" } },
    { op: "dedupe", by: ["email"], keep: "first" },
  ],
  outputs: [{ kind: "file", name: "clean-contacts.csv", format: "csv" }],
};
// A different reading: dedupe on the raw email, missing the case variants.
const dedupeLiteral: Recipe = {
  inputs: [{ slot: "contacts", format: "csv" }],
  steps: [{ op: "dedupe", by: ["email"], keep: "first" }],
  outputs: [{ kind: "file", name: "clean-contacts.csv", format: "csv" }],
};

export const SCRIPTED_ANSWERS: Answer[] = [
  {
    match: /total sales by item/i,
    intent: { title: "Sales total by item", restatement: "Multiply quantity by price for each order and add it up per item.", outputs: [{ name: "totals.json", shape: "object of key to value" }], needs: ["file.read", "file.write", "view.show"], feasible: true, missing: "" },
    recipes: [totals, totals, totalsWrong, totals, totals],
  },
  {
    match: /duplicate contacts/i,
    intent: { title: "Deduplicate contacts", restatement: "Keep one row per email address, ignoring case and spaces.", outputs: [{ name: "clean-contacts.csv", shape: "table of rows" }], needs: ["file.read", "file.write"], feasible: true, missing: "" },
    recipes: [dedupe, dedupe, dedupe, dedupe, dedupe],
  },
  {
    match: /clean up (my )?contacts/i,
    intent: { title: "Clean up contacts", restatement: "Remove repeated contacts.", outputs: [{ name: "clean-contacts.csv", shape: "table of rows" }], needs: ["file.read", "file.write"], feasible: true, missing: "" },
    recipes: [dedupe, dedupeLiteral, dedupe, dedupeLiteral, dedupeLiteral],
  },
  {
    match: /email (it|this|them)|send .* email/i,
    intent: { title: "Email a file", restatement: "Send the file by email.", outputs: [], needs: ["email.send"], feasible: true, missing: "" },
  },
];
