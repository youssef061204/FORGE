import { readFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decode, formatFromName } from "../../src/core/codec";
import { compileRecipe, runPlan } from "../../src/core/recipe/engine";
import { recipeSchema } from "../../src/core/recipe/schema";
import { profileTable, schemaOf } from "../../src/core/profile";
import { EXEMPLARS } from "../../src/core/synth/exemplars";
import { jaccard, trigrams, words } from "../../src/core/synth/similarity";

function corpusRequests(): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const dev = JSON.parse(readFileSync("evaluation/local-missions.json", "utf8"));
  for (const c of dev.cases) out.push({ id: `dev:${c.id}`, text: c.goal });
  if (existsSync("evaluation/validation"))
    for (const f of readdirSync("evaluation/validation").filter((f) => f.endsWith(".json") && f !== "manifest.json")) {
      const v = JSON.parse(readFileSync(`evaluation/validation/${f}`, "utf8"));
      for (const c of v.cases ?? []) out.push({ id: `val:${c.id}`, text: c.request });
    }
  return out;
}

describe("exemplar memory", () => {
  it("has at least 40 exemplars with unique ids", () => {
    expect(EXEMPLARS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(EXEMPLARS.map((e) => e.id)).size).toBe(EXEMPLARS.length);
  });

  it.each(EXEMPLARS.map((e) => [e.id, e] as const))("%s runs and produces its expected output", (_, ex) => {
    const tables = Object.fromEntries(
      Object.entries(ex.files).map(([slot, f]) => {
        const input = ex.recipe.inputs.find((i) => i.slot === slot);
        const format = input?.format ?? formatFromName(f.name)!;
        return [slot, decode(f.text, format, input?.path ? { tablePath: input.path.split(".") } : {}).table];
      }),
    );
    const schemas = Object.fromEntries(Object.entries(tables).map(([k, t]) => [k, schemaOf(profileTable(t))]));
    const plan = compileRecipe(recipeSchema.parse(ex.recipe), schemas);
    const result = runPlan(plan, tables);
    const file = result.outputs.find((o) => o.kind === "file");
    expect(file && file.kind === "file" && file.text).toBe(ex.expect);
  });

  it("covers every step operation", () => {
    const ops = new Set(EXEMPLARS.flatMap((e) => e.recipe.steps.map((s) => s.op)));
    for (const op of ["filter", "derive", "select", "drop", "rename", "sort", "dedupe", "summarize", "join", "unnest", "lines", "match", "limit", "union"])
      expect(ops, op).toContain(op);
  });

  it("is not derived from any evaluation corpus", () => {
    // Word overlap and character-trigram overlap both stay well below what a
    // paraphrase of a corpus mission would produce.
    for (const ex of EXEMPLARS)
      for (const mission of corpusRequests()) {
        const w = jaccard(new Set(words(ex.request)), new Set(words(mission.text)));
        const t = jaccard(trigrams(ex.request), trigrams(mission.text));
        expect(w, `${ex.id} vs ${mission.id}`).toBeLessThan(0.34);
        expect(t, `${ex.id} vs ${mission.id}`).toBeLessThan(0.4);
      }
  });
});
