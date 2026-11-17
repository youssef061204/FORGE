/**
 * Eject: an approved tool as one standalone JavaScript file with no
 * dependencies. `node tool.mjs orders.csv` writes its outputs next to you.
 * Built from the same emitted TypeScript that translation validation checks.
 */
import { build } from "esbuild";
import { join } from "node:path";
import { emitTypeScript } from "../core/recipe/emit-ts";
import type { Recipe } from "../core/recipe/schema";

export async function eject(recipe: Recipe, name: string): Promise<string> {
  const program = emitTypeScript(recipe);
  const entry = `
import { helpers as H } from "./recipe/emit-helpers";
import { decode, encodeTable, formatFromName, sniffFormat } from "./codec";
import { encodeFile } from "./recipe/engine";
import { readFileSync, writeFileSync } from "node:fs";
${program.replace("export function run", "function run")}
const RECIPE = ${JSON.stringify(recipe)};
const files = process.argv.slice(2);
if (files.length !== RECIPE.inputs.length) {
  console.error("Usage: node " + ${JSON.stringify(name)} + " " + RECIPE.inputs.map((i) => "<" + i.slot + " file>").join(" "));
  process.exit(1);
}
const tables = {}, cols = {};
RECIPE.inputs.forEach((input, k) => {
  const text = readFileSync(files[k], "utf8");
  const t = decode(text, input.format ?? formatFromName(files[k]) ?? sniffFormat(text), input.path ? { tablePath: input.path.split(".") } : {}).table;
  tables[input.slot] = t.rows; cols[input.slot] = t.columns;
});
H.now = new Date().toISOString();
const out = run(tables, cols, H);
const last = Object.keys(cols).at(-1);
for (const o of RECIPE.outputs) {
  if (o.kind !== "file") continue;
  const rows = (o.from ? out[o.from] : out.__final) ?? [];
  const columns = o.columns ?? cols[o.from ?? last] ?? [];
  writeFileSync(o.name, encodeFile(o, { columns, rows }, columns).text);
  console.log("wrote " + o.name + " (" + rows.length + " rows)");
}
void encodeTable;
`;
  const result = await build({
    stdin: { contents: entry, loader: "ts", resolveDir: join(process.cwd(), "src", "core"), sourcefile: "tool.ts" },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node20",
    minify: false,
    legalComments: "none",
    banner: { js: `#!/usr/bin/env node\n// ${name}: ejected from FORGE. No dependencies. Reads only the files you pass; writes only its declared outputs.` },
  });
  return result.outputFiles[0].text;
}
