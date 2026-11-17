/**
 * Host-side shape alignment. The intent call states what each output file
 * looks like ("a list of values", "an object of key to value"). When a draft's
 * output disagrees and exactly one fix is consistent with its final columns,
 * the host applies that fix and records it as a visible host repair. Anything
 * ambiguous is left alone for the model's repair loop.
 */
import type { Plan } from "../recipe/engine";
import type { FileOutput, Recipe } from "../recipe/schema";
import { outputShape, type OutputShape } from "../verify/properties";

export type Alignment = { recipe: Recipe; notes: string[] };

export function alignShapes(recipe: Recipe, plan: Plan, intentShapes: Record<string, OutputShape>): Alignment {
  const notes: string[] = [];
  const outputs = recipe.outputs.map((o, i) => {
    if (o.kind !== "file") return o;
    const want = intentShapes[o.name.toLowerCase()];
    if (!want || want === "chart" || outputShape(o) === want) return o;
    const compiled = plan.outputs[i];
    const cols = o.columns ?? compiled?.columns ?? [];
    const lastRowChanging = [...recipe.steps].reverse().find((s) => s.op !== "derive" && s.op !== "select" && s.op !== "drop" && s.op !== "rename" && s.op !== "sort");
    let next: FileOutput | undefined;
    if (o.format === "json") {
      if (want === "list of values" && cols.length === 1) next = { ...o, shape: { values: cols[0] } };
      else if (want === "object of key to value" && cols.length === 2) next = { ...o, shape: { map: { key: cols[0], value: cols[1] } } };
      else if (want === "one object" && lastRowChanging?.op === "summarize" && !lastRowChanging.by?.length) next = { ...o, shape: "row" };
      else if (want === "table of rows" && o.shape !== undefined) {
        const { shape: _drop, ...rest } = o;
        void _drop;
        next = rest as FileOutput;
      }
    } else if (o.format === "text" && want === "lines of text") next = o;
    if (!next || next === o) return o;
    notes.push(`${o.name}: written as ${want} to match the request`);
    return next;
  });
  return notes.length ? { recipe: { ...recipe, outputs }, notes } : { recipe, notes };
}
