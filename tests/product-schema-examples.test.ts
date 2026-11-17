import { describe, expect, it } from "vitest";
import { schemaExample } from "../src/forge/product/grounded-model";
import { validateJson } from "../src/forge/product/schemas";
import type { JsonSchema } from "../src/forge/product/contracts";

function expectValid(schema: JsonSchema, variant = 0) {
  const value = schemaExample(schema, variant);
  expect(() => validateJson(schema, value, "Synthetic example")).not.toThrow();
  return value;
}

describe("bounded compiler-consistency schema examples", () => {
  it("honors array lower bounds beyond the former sample-size shortcut", () => {
    const value = expectValid({
      type: "array",
      minItems: 21,
      maxItems: 30,
      items: { type: "integer" },
    }) as unknown[];
    expect(value).toHaveLength(21);
  });

  it("honors numeric multiples", () => {
    expect(expectValid({ type: "number", minimum: 0, multipleOf: 3 }, 1)).toBe(
      3,
    );
  });

  it("supports bounded anchored character-range patterns", () => {
    expect(expectValid({ type: "string", pattern: "^[A-Z]{2}$" })).toBe("AA");
  });

  it("generates distinct boolean values for satisfiable unique arrays", () => {
    expect(
      expectValid({
        type: "array",
        minItems: 2,
        maxItems: 2,
        uniqueItems: true,
        items: { type: "boolean" },
      }),
    ).toEqual([true, false]);
  });
});
