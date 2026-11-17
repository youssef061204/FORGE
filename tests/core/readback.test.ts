import { describe, expect, it } from "vitest";
import { decode } from "../../src/core/codec";
import { compileRecipe } from "../../src/core/recipe/engine";
import { recipeSchema } from "../../src/core/recipe/schema";
import { profileTable, schemaOf } from "../../src/core/profile";
import { checkProperties } from "../../src/core/verify/properties";
import { makeVariants } from "../../src/core/verify/variants";

describe("CSV read-back property", () => {
  it("treats a null cell (left join without a match) as the empty cell the encoder writes", () => {
    const left = decode("id,name\n1,a\n2,b\n", "csv").table;
    const right = decode("id,tag\n1,x\n", "csv").table;
    const recipe = recipeSchema.parse({
      inputs: [{ slot: "left" }, { slot: "right" }],
      steps: [{ op: "join", with: "right", on: ["id"], kind: "left" }],
      outputs: [{ kind: "file", name: "out.csv", format: "csv" }],
    });
    const inputs = { left, right };
    const plan = compileRecipe(recipe, { left: schemaOf(profileTable(left)), right: schemaOf(profileTable(right)) });
    const props = checkProperties({ request: "join them", recipe, plan, inputs, inputNames: [], profiles: {}, variants: makeVariants(inputs) });
    expect(props.find((p) => p.name === "out.csv reads back exactly")?.passed).toBe(true);
  });
});
