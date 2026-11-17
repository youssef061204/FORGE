import { describe, expect, it } from "vitest";
import { decode, formatFromName } from "../../src/core/codec";
import { compileRecipe } from "../../src/core/recipe/engine";
import { recipeSchema } from "../../src/core/recipe/schema";
import { profileTable, schemaOf } from "../../src/core/profile";
import { EXEMPLARS } from "../../src/core/synth/exemplars";
import { fuzzInputs, makeVariants } from "../../src/core/verify/variants";
import { lowerAndVerify } from "../../src/server/verify";

describe("translation validation: emitted TypeScript vs the interpreter", () => {
  it.each(EXEMPLARS.map((e) => [e.id, e] as const))("%s agrees on real data, variants and fuzz", (_, ex) => {
    const tables = Object.fromEntries(
      Object.entries(ex.files).map(([slot, f]) => {
        const input = ex.recipe.inputs.find((i) => i.slot === slot);
        return [slot, decode(f.text, input?.format ?? formatFromName(f.name)!, input?.path ? { tablePath: input.path.split(".") } : {}).table];
      }),
    );
    const recipe = recipeSchema.parse(ex.recipe);
    const plan = compileRecipe(recipe, Object.fromEntries(Object.entries(tables).map(([k, t]) => [k, schemaOf(profileTable(t))])));
    const inputs = [tables, ...makeVariants(tables).map((v) => v.inputs), ...fuzzInputs(tables, 3).map((v) => v.inputs)];
    const { checks, lowered } = lowerAndVerify(recipe, plan, inputs, "2026-11-17T12:00:00.000Z");
    expect(lowered?.typescript).toContain("export function run");
    expect(checks[0].passed, checks[0].detail).toBe(true);
  });
});
