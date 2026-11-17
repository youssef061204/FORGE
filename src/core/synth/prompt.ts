/** Prompts for the Crucible. One shared prefix per build, so the model's prefix cache pays for it once. */
import { CAPABILITIES, CAPABILITY_IDS } from "../contracts/capabilities";
import type { TableProfile } from "../profile";
import type { Recipe } from "../recipe/schema";
import type { Row } from "../table";
import type { Exemplar } from "./exemplars";

export const DRAFT_SYSTEM = `You write FORGE recipes: small JSON programs that turn the user's files into the result they asked for.
A recipe has "inputs", "steps" and "outputs". Steps run in order. Each step reads the previous step's table (or the table named in "from") and may name its result with "as".

Steps:
{"op":"filter","where":EXPR}  keep rows where EXPR is true
{"op":"derive","set":{"col":EXPR}}  add or replace columns
{"op":"select","columns":["a","b"]}  keep these columns, in this order
{"op":"drop","columns":["a"]}
{"op":"rename","map":{"old":"new"}}
{"op":"sort","by":["EXPR","EXPR desc"]}
{"op":"dedupe","by":["EXPR"],"keep":"first"}  remove repeated rows ("last" keeps the last one)
{"op":"summarize","by":["col"],"set":{"col":AGGREGATE}}  one row per group; omit "by" for one row overall
{"op":"join","with":"other_input","on":["col"],"kind":"inner"}  kinds: inner, left, anti (no match), semi (has match)
{"op":"unnest","column":"list_col","into":"item"}  one row per list item
{"op":"lines","column":"text_col","into":"line"}  one row per line of text
{"op":"match","column":"col","pattern":"REGEX"}  keep rows matching; named groups (?<name>...) become columns
{"op":"limit","n":10}
{"op":"union","with":"other_input"}  stack rows

Outputs:
{"kind":"file","name":"out.csv","format":"csv","columns":["a","b"]}  formats: csv, tsv, json, text; "columns" is optional
  JSON "shape": omit it for a list of row objects; "row" for one object; {"map":{"key":"col","value":"col"}} for an object of key to value; {"values":"col"} for a list of one column.
  A text file writes one value per line: give "shape":{"values":"col"}.
{"kind":"view","type":"bar","x":"col","y":"col"}  types: bar, line, table, stat

EXPR: column names, nested.fields, \`odd name\`, 'text', numbers, true, false, + - * / %, == != < <= > >=, and, or, not, x in ['a','b'].
Functions: num text bool lower upper trim title len contains icontains starts_with ends_with replace regex_replace left right slice split split_part join concat coalesce if is_null is_empty is_number round floor ceil abs least greatest date year month day month_key weekday days_between add_days matches extract.
AGGREGATE: count() count(x) count_distinct(x) sum(x) mean(x) median(x) min(x) max(x) first(x) last(x) list(x). Inside derive or filter an aggregate means the whole table, e.g. votes / sum(votes).

Rules:
- CSV and text cells are text. Write num(x) to sort or compare numerically; arithmetic reads numbers by itself.
- A text input has columns line and number.
- Use the user's file names exactly. Keep the original row order unless asked to sort.
- Use only the columns listed for each input. Never invent data.
- The first rows are only a sample: never filter or sort by row position or line number unless the request asks for it.
- After a match step, refer to a named group by its plain name, e.g. (?<task>.*) becomes the column task.
- Reply with the recipe JSON only.`;

function kindLabel(kind: string, storage: string) {
  if (storage === "text" && (kind === "number" || kind === "integer")) return "number-like text";
  if (storage === "text" && kind === "date") return "date text";
  if (storage === "text" && kind === "boolean") return "true/false text";
  return kind === "mixed" ? "mixed" : kind;
}

export function describeInput(slot: string, name: string, format: string, profile: TableProfile, sample: Row[], rowsShown = 3): string {
  const cols = profile.columns
    .map((c) => {
      const ex = c.samples
        .slice(0, 2)
        .map((s) => JSON.stringify(s))
        .join(", ")
        .slice(0, 60);
      const fields = c.fields?.length ? `; fields: ${c.fields.slice(0, 8).join(", ")}` : "";
      return `  ${c.name} (${kindLabel(c.kind, c.storage)}${ex ? `, e.g. ${ex}` : ""}${fields})`;
    })
    .join("\n");
  const rows = sample
    .slice(0, rowsShown)
    .map((r) => "  " + JSON.stringify(r).slice(0, 240))
    .join("\n");
  return `- ${slot}: ${name} (${format}, ${profile.rows} rows)\n${cols}\n  first rows:\n${rows}`;
}

export function exemplarBlock(ex: Exemplar, profiles: Record<string, TableProfile>): string {
  const inputs = ex.recipe.inputs
    .map((i) => {
      const p = profiles[i.slot];
      const cols = p ? p.columns.map((c) => `${c.name} (${kindLabel(c.kind, c.storage)})`).join(", ") : "";
      return `- ${i.slot}: ${ex.files[i.slot]?.name ?? i.slot} — ${cols}`;
    })
    .join("\n");
  return `Request: ${ex.request}\nInputs:\n${inputs}\nRecipe: ${JSON.stringify(ex.recipe)}`;
}

export type DraftContext = {
  request: string;
  inputs: { slot: string; name: string; format: string; profile: TableProfile; sample: Row[] }[];
  exemplars: string[];
  base?: Recipe;
  examples?: string[];
};

/** The shared prefix: identical for every draft of a build. */
export function draftPrompt(ctx: DraftContext): string {
  const parts = [`Examples of good recipes:\n\n${ctx.exemplars.join("\n\n")}`];
  parts.push(`Now the real task.\nInputs:\n${ctx.inputs.map((i) => describeInput(i.slot, i.name, i.format, i.profile, i.sample)).join("\n")}`);
  if (ctx.base) parts.push(`The current tool's recipe, to be changed as requested:\n${JSON.stringify(ctx.base)}`);
  if (ctx.examples?.length) parts.push(`The result must reproduce these confirmed examples exactly:\n${ctx.examples.join("\n")}`);
  parts.push(`Request: ${ctx.request}\nRecipe:`);
  return parts.join("\n\n");
}

export function repairPrompt(ctx: DraftContext, failed: string, problems: string[]): string {
  return `${draftPrompt(ctx)}\n\nA previous attempt was:\n${failed.slice(0, 3000)}\n\nIt has these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nWrite the corrected recipe JSON only.`;
}

export const INTENT_SYSTEM = `You read a request for FORGE, which builds small data tools from the user's files. Work out what the user wants. Do not solve it.
Capabilities:
${CAPABILITY_IDS.map((id) => `- ${id}: ${CAPABILITIES[id].label}`).join("\n")}
"needs" lists every capability the finished result requires. Reading files is file.read; saving results is file.write; a chart is view.show.
Only list email.send, calendar.create, web.fetch, chat.post, sms.send, sheet.write, drive.upload or payment.send when the user wants that action really carried out, not when a column merely mentions it.
"outputs" lists each output file the user asked for (invent a short sensible name if they gave none) and its shape:
- "table of rows": a CSV/TSV file, or JSON array of row objects
- "one object": a single JSON object with fixed fields, e.g. {"total": 5, "count": 2}
- "object of key to value": a JSON object whose keys come from the data, e.g. {"open": 3, "closed": 1}
- "list of values": a JSON array of plain values, e.g. ["a", "b"]
- "lines of text": a text file with one value per line
- "chart": a chart or table shown on screen
"feasible" is false only for things no data recipe can do, such as generating images or predicting the future.
"missing" names essential information that is absent (for example which file to use); otherwise it is an empty string.`;

export function intentPrompt(request: string, files: { slot: string; name: string; columns: string[] }[], tools: { name: string; description: string }[]): string {
  const f = files.length ? files.map((x) => `- ${x.name} (columns: ${x.columns.slice(0, 20).join(", ")})`).join("\n") : "(no files attached)";
  const t = tools.length ? `\nInstalled tools:\n${tools.map((x) => `- ${x.name}: ${x.description}`).join("\n")}` : "";
  return `Files:\n${f}${t}\n\nRequest: ${request}`;
}

export const OUTPUT_SHAPES = ["table of rows", "one object", "object of key to value", "list of values", "lines of text", "chart"] as const;
export type OutputShape = (typeof OUTPUT_SHAPES)[number];

export const INTENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    restatement: { type: "string" },
    outputs: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, shape: { enum: OUTPUT_SHAPES } },
        required: ["name", "shape"],
        additionalProperties: false,
      },
    },
    needs: { type: "array", items: { enum: CAPABILITY_IDS } },
    feasible: { type: "boolean" },
    missing: { type: "string" },
  },
  required: ["title", "restatement", "outputs", "needs", "feasible", "missing"],
  additionalProperties: false,
};
