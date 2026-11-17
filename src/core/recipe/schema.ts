/**
 * The recipe envelope: named inputs, a flat list of steps, and outputs.
 * Structure is guaranteed by a JSON Schema (Ollama's `format` parameter);
 * expression strings inside it are parsed by expr.ts with located errors.
 */
import { z } from "zod";

z.config({ jitless: true }); // core must run under a CSP without eval

const name = z.string().min(1).max(80);
const exprText = z.string().min(1).max(600);
const setMap = z.record(name, exprText).refine((m) => Object.keys(m).length > 0, "needs at least one column");
const base = { from: name.optional(), as: name.optional(), note: z.string().max(200).optional() };

export const stepSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("filter"), where: exprText, ...base }).strict(),
  z.object({ op: z.literal("derive"), set: setMap, ...base }).strict(),
  z.object({ op: z.literal("select"), columns: z.array(name).min(1).max(200), ...base }).strict(),
  z.object({ op: z.literal("drop"), columns: z.array(name).min(1).max(200), ...base }).strict(),
  z.object({ op: z.literal("rename"), map: z.record(name, name), ...base }).strict(),
  z.object({ op: z.literal("sort"), by: z.array(exprText).min(1).max(8), ...base }).strict(),
  z
    .object({
      op: z.literal("dedupe"),
      by: z.array(exprText).max(8).optional(),
      keep: z.enum(["first", "last"]).optional(),
      ...base,
    })
    .strict(),
  z
    .object({ op: z.literal("summarize"), by: z.array(name).max(8).optional(), set: setMap, ...base })
    .strict(),
  z
    .object({
      op: z.literal("join"),
      with: name,
      on: z.union([z.array(name).min(1).max(4), z.record(name, name)]),
      kind: z.enum(["inner", "left", "anti", "semi"]).optional(),
      ...base,
    })
    .strict(),
  z.object({ op: z.literal("unnest"), column: name, into: name.optional(), ...base }).strict(),
  z.object({ op: z.literal("lines"), column: name, into: name.optional(), ...base }).strict(),
  z
    .object({
      op: z.literal("match"),
      column: name,
      pattern: z.string().min(1).max(500),
      keep: z.enum(["matching", "all"]).optional(),
      ...base,
    })
    .strict(),
  z
    .object({
      op: z.literal("limit"),
      n: z.number().int().min(0).max(1_000_000),
      offset: z.number().int().min(0).max(1_000_000).optional(),
      ...base,
    })
    .strict(),
  z.object({ op: z.literal("union"), with: name, ...base }).strict(),
]);
export type Step = z.infer<typeof stepSchema>;
export type StepOp = Step["op"];
export const STEP_OPS = stepSchema.options.map((o) => o.shape.op.value) as StepOp[];

const fileShape = z.union([
  z.literal("rows"),
  z.literal("row"),
  z.object({ map: z.object({ key: name, value: name }).strict() }).strict(),
  z.object({ values: name }).strict(),
]);
export type FileShape = z.infer<typeof fileShape>;

export const outputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("file"),
      name: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[^/\\:*?"<>|]+$/, "a file name, not a path"),
      format: z.enum(["csv", "tsv", "json", "text"]),
      from: name.optional(),
      columns: z.array(name).min(1).max(200).optional(),
      shape: fileShape.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("view"),
      type: z.enum(["bar", "line", "table", "stat"]),
      from: name.optional(),
      x: name.optional(),
      y: name.optional(),
      title: z.string().max(80).optional(),
    })
    .strict(),
]);
export type Output = z.infer<typeof outputSchema>;
export type FileOutput = Extract<Output, { kind: "file" }>;
export type ViewOutput = Extract<Output, { kind: "view" }>;

export const inputSchema = z
  .object({
    slot: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, "a short name such as orders"),
    format: z.enum(["csv", "tsv", "json", "text"]).optional(),
    path: z.string().max(200).optional(),
  })
  .strict();
export type InputSlot = z.infer<typeof inputSchema>;

export const recipeSchema = z
  .object({
    inputs: z.array(inputSchema).min(1).max(8),
    steps: z.array(stepSchema).max(30),
    outputs: z.array(outputSchema).min(1).max(8),
  })
  .strict();
export type Recipe = z.infer<typeof recipeSchema>;

export const RECIPE_VERSION = "forge-recipe/1";

/** JSON Schema given to the model so structure is guaranteed by grammar. */
export function recipeJsonSchema(slots?: string[]): Record<string, unknown> {
  const str = { type: "string" };
  const strMap = { type: "object", additionalProperties: str };
  const strList = { type: "array", items: str };
  const step = (op: string, props: Record<string, unknown>, required: string[]) => ({
    type: "object",
    properties: { op: { const: op }, ...props, as: str, from: str },
    required: ["op", ...required],
    additionalProperties: false,
  });
  return {
    type: "object",
    properties: {
      inputs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slot: slots?.length ? { enum: slots } : str,
            format: { enum: ["csv", "tsv", "json", "text"] },
            path: str,
          },
          required: ["slot"],
          additionalProperties: false,
        },
      },
      steps: {
        type: "array",
        items: {
          anyOf: [
            step("filter", { where: str }, ["where"]),
            step("derive", { set: strMap }, ["set"]),
            step("select", { columns: strList }, ["columns"]),
            step("drop", { columns: strList }, ["columns"]),
            step("rename", { map: strMap }, ["map"]),
            step("sort", { by: strList }, ["by"]),
            step("dedupe", { by: strList, keep: { enum: ["first", "last"] } }, []),
            step("summarize", { by: strList, set: strMap }, ["set"]),
            step("join", { with: str, on: strList, kind: { enum: ["inner", "left", "anti", "semi"] } }, ["with", "on"]),
            step("unnest", { column: str, into: str }, ["column"]),
            step("lines", { column: str, into: str }, ["column"]),
            step("match", { column: str, pattern: str, keep: { enum: ["matching", "all"] } }, ["column", "pattern"]),
            step("limit", { n: { type: "integer" }, offset: { type: "integer" } }, ["n"]),
            step("union", { with: str }, ["with"]),
          ],
        },
      },
      outputs: {
        type: "array",
        items: {
          anyOf: [
            {
              type: "object",
              properties: {
                kind: { const: "file" },
                name: str,
                format: { enum: ["csv", "tsv", "json", "text"] },
                from: str,
                columns: strList,
                shape: {
                  anyOf: [
                    { enum: ["rows", "row"] },
                    {
                      type: "object",
                      properties: {
                        map: {
                          type: "object",
                          properties: { key: str, value: str },
                          required: ["key", "value"],
                          additionalProperties: false,
                        },
                      },
                      required: ["map"],
                      additionalProperties: false,
                    },
                    {
                      type: "object",
                      properties: { values: str },
                      required: ["values"],
                      additionalProperties: false,
                    },
                  ],
                },
              },
              required: ["kind", "name", "format"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                kind: { const: "view" },
                type: { enum: ["bar", "line", "table", "stat"] },
                from: str,
                x: str,
                y: str,
                title: str,
              },
              required: ["kind", "type"],
              additionalProperties: false,
            },
          ],
        },
      },
    },
    required: ["inputs", "steps", "outputs"],
    additionalProperties: false,
  };
}
