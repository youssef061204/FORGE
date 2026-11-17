import { z } from "zod";
import type { JsonSchema } from "./contracts";

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const scalarNames = [
  "number",
  "string",
  "trim",
  "lower",
  "upper",
  "split",
  "join",
  "length",
  "concat",
  "add",
  "subtract",
  "multiply",
  "divide",
  "modulo",
  "round",
  "floor",
  "abs",
  "min",
  "max",
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "and",
  "or",
  "not",
  "if",
  "coalesce",
  "isNull",
  "includes",
  "startsWith",
  "endsWith",
  "slice",
  "replace",
  "isoDate",
  "dateAddDays",
  "sum",
  "keys",
  "values",
  "entries",
] as const;
export type IRScalarName = (typeof scalarNames)[number];

export type IRAggregate =
  | { op: "count" }
  | {
      op: "sum" | "min" | "max" | "mean" | "first" | "last" | "collect";
      value: IRExpr;
    };

export type IRStep =
  | { op: "filter"; as: string; where: IRExpr }
  | { op: "project"; as: string; value: IRExpr }
  | { op: "flatMap"; as: string; value: IRExpr }
  | {
      op: "join";
      right: IRExpr;
      leftAs: string;
      rightAs: string;
      on: IRExpr;
      mode: "inner" | "left";
    }
  | {
      op: "group";
      as: string;
      keys: Record<string, IRExpr>;
      aggregates: Record<string, IRAggregate>;
    }
  | { op: "distinct"; as: string; by?: IRExpr; keep?: "first" | "last" }
  | {
      op: "sort";
      as: string;
      by: {
        value: IRExpr;
        direction: "asc" | "desc";
        nulls?: "first" | "last";
      }[];
    }
  | { op: "slice"; offset: number; limit: number }
  | {
      op: "record";
      as: string;
      key: IRExpr;
      value: IRExpr;
      duplicates?: "error" | "first" | "last";
    };

export type IRExpr =
  | { kind: "literal"; value: JsonValue }
  | { kind: "get"; root: string; path: (string | number)[] }
  | { kind: "object"; fields: Record<string, IRExpr> }
  | { kind: "array"; items: IRExpr[] }
  | { kind: "scalar"; op: IRScalarName; args: IRExpr[] }
  | { kind: "query"; source: IRExpr; steps: IRStep[] }
  | {
      kind: "encode";
      format: "csv" | "json" | "text";
      value: IRExpr;
      /** Omit to infer the data contract from the typed value expression. */
      schema?: JsonSchema;
      columns?: IRExpr;
      terminalNewline?: boolean;
    };

export type IREffect = {
  operation: string;
  arguments: IRExpr;
  when?: IRExpr;
  forEach?: { source: IRExpr; item: string };
};

export type ForgeIR = {
  version: "forge-ir/v1";
  bindings: { id: string; value: IRExpr }[];
  effects: IREffect[];
  result: { summary: IRExpr; details?: IRExpr };
  state?: IRExpr;
};

export type IRDiagnostic = {
  stage: "parse" | "bind" | "type" | "budget" | "evaluate" | "emit";
  code: string;
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
};

export class IRCompileError extends Error {
  readonly diagnostics: IRDiagnostic[];
  constructor(diagnostics: IRDiagnostic[]) {
    super(
      diagnostics
        .map((item) => `${item.path || "/"}: ${item.message}`)
        .slice(0, 3)
        .join("; "),
    );
    this.name = "IRCompileError";
    this.diagnostics = diagnostics;
  }
}

export const IR_LIMITS = {
  planChars: 32768,
  planDepth: 40,
  planNodes: 2000,
  inputBytes: 131072,
  collection: 1000,
  work: 50000,
  effects: 20,
  outputBytes: 8192,
} as const;

export const IR_RESERVED_ROOTS = [
  "input",
  "observations",
  "params",
  "state",
  "now",
] as const;
export const IR_UNSAFE_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);
const name = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/);
const property = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) => !IR_UNSAFE_KEYS.has(value),
    "Prototype-related names are unavailable",
  );
const jsonSchema = z.record(z.string(), z.unknown());
const expressions = (): z.ZodType<IRExpr> => expressionSchema;
const steps = (): z.ZodType<IRStep> => stepSchema;

const expressionSchema: z.ZodType<IRExpr> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("literal"),
        value: z.unknown() as z.ZodType<JsonValue>,
      })
      .strict(),
    z
      .object({
        kind: z.literal("get"),
        root: name,
        path: z
          .array(z.union([property, z.number().int().min(0).max(1000000)]))
          .max(20),
      })
      .strict(),
    z
      .object({
        kind: z.literal("object"),
        fields: z.record(property, expressions()),
      })
      .strict(),
    z
      .object({
        kind: z.literal("array"),
        items: z.array(expressions()).max(1000),
      })
      .strict(),
    z
      .object({
        kind: z.literal("scalar"),
        op: z.enum(scalarNames),
        args: z.array(expressions()).max(32),
      })
      .strict(),
    z
      .object({
        kind: z.literal("query"),
        source: expressions(),
        steps: z.array(steps()).max(20),
      })
      .strict(),
    z
      .object({
        kind: z.literal("encode"),
        format: z.enum(["csv", "json", "text"]),
        value: expressions(),
        schema: jsonSchema.optional(),
        columns: expressions().optional(),
        terminalNewline: z.boolean().optional(),
      })
      .strict(),
  ]),
);

const aggregateSchema: z.ZodType<IRAggregate> = z.lazy(() =>
  z.union([
    z.object({ op: z.literal("count") }).strict(),
    z
      .object({
        op: z.enum(["sum", "min", "max", "mean", "first", "last", "collect"]),
        value: expressions(),
      })
      .strict(),
  ]),
);

const stepSchema: z.ZodType<IRStep> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z
      .object({ op: z.literal("filter"), as: name, where: expressions() })
      .strict(),
    z
      .object({ op: z.literal("project"), as: name, value: expressions() })
      .strict(),
    z
      .object({ op: z.literal("flatMap"), as: name, value: expressions() })
      .strict(),
    z
      .object({
        op: z.literal("join"),
        right: expressions(),
        leftAs: name,
        rightAs: name,
        on: expressions(),
        mode: z.enum(["inner", "left"]),
      })
      .strict(),
    z
      .object({
        op: z.literal("group"),
        as: name,
        keys: z.record(property, expressions()),
        aggregates: z.record(property, aggregateSchema),
      })
      .strict(),
    z
      .object({
        op: z.literal("distinct"),
        as: name,
        by: expressions().optional(),
        keep: z.enum(["first", "last"]).optional(),
      })
      .strict(),
    z
      .object({
        op: z.literal("sort"),
        as: name,
        by: z
          .array(
            z
              .object({
                value: expressions(),
                direction: z.enum(["asc", "desc"]),
                nulls: z.enum(["first", "last"]).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(8),
      })
      .strict(),
    z
      .object({
        op: z.literal("slice"),
        offset: z.number().int().min(0).max(1000000),
        limit: z.number().int().min(0).max(1000),
      })
      .strict(),
    z
      .object({
        op: z.literal("record"),
        as: name,
        key: expressions(),
        value: expressions(),
        duplicates: z.enum(["error", "first", "last"]).optional(),
      })
      .strict(),
  ]),
);

const bareForgeIRSchema: z.ZodType<ForgeIR> = z
  .object({
    version: z.literal("forge-ir/v1"),
    bindings: z
      .array(z.object({ id: name, value: expressionSchema }).strict())
      .max(32),
    effects: z
      .array(
        z
          .object({
            operation: z
              .string()
              .regex(/^[a-z][a-z0-9_-]{0,47}\.[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/),
            arguments: expressionSchema,
            when: expressionSchema.optional(),
            forEach: z
              .object({ source: expressionSchema, item: name })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(IR_LIMITS.effects),
    result: z
      .object({
        summary: expressionSchema,
        details: expressionSchema.optional(),
      })
      .strict(),
    state: expressionSchema.optional(),
  })
  .strict();

// Validate the raw JSON graph before recursive schema parsing: cycles, accessors,
// non-JSON values and deeply nested plans must not reach the recursive parser.
export function assertIRJson(
  value: unknown,
  options: {
    depth?: number;
    nodes?: number;
    chars?: number;
    collection?: number;
  } = {},
) {
  const active = new Set<object>();
  let nodes = 0;
  const maxDepth = options.depth ?? IR_LIMITS.planDepth;
  const maxNodes = options.nodes ?? IR_LIMITS.planNodes;
  function walk(item: unknown, depth: number, path: string) {
    if (++nodes > maxNodes || depth > maxDepth)
      throw new IRCompileError([
        {
          stage: "budget",
          code: "JSON_BUDGET",
          path,
          message: "JSON structure exceeds its depth or node budget",
        },
      ]);
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object")
      throw new IRCompileError([
        {
          stage: "parse",
          code: "NON_JSON_VALUE",
          path,
          message: "Only finite JSON data is allowed",
        },
      ]);
    if (active.has(item))
      throw new IRCompileError([
        {
          stage: "parse",
          code: "CYCLIC_JSON",
          path,
          message: "Cyclic values are unavailable",
        },
      ]);
    const prototype = Object.getPrototypeOf(item);
    if (
      !Array.isArray(item) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      throw new IRCompileError([
        {
          stage: "parse",
          code: "NON_JSON_OBJECT",
          path,
          message: "Only ordinary JSON objects are allowed",
        },
      ]);
    if (Object.getOwnPropertySymbols(item).length)
      throw new IRCompileError([
        {
          stage: "parse",
          code: "NON_JSON_VALUE",
          path,
          message: "Symbol properties are unavailable",
        },
      ]);
    if (
      Array.isArray(item) &&
      item.length > (options.collection ?? IR_LIMITS.collection)
    )
      throw new IRCompileError([
        {
          stage: "budget",
          code: "COLLECTION_BUDGET",
          path,
          message: "Collection exceeds its row budget",
        },
      ]);
    active.add(item);
    const descriptors = Object.getOwnPropertyDescriptors(item);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(item) && key === "length") continue;
      if (IR_UNSAFE_KEYS.has(key))
        throw new IRCompileError([
          {
            stage: "parse",
            code: "UNSAFE_KEY",
            path: `${path}/${key}`,
            message: "Prototype-related names are unavailable",
          },
        ]);
      if (!Object.hasOwn(descriptor, "value"))
        throw new IRCompileError([
          {
            stage: "parse",
            code: "NON_JSON_OBJECT",
            path,
            message: "Accessor properties are unavailable",
          },
        ]);
      if (!descriptor.enumerable)
        throw new IRCompileError([
          {
            stage: "parse",
            code: "NON_JSON_OBJECT",
            path,
            message: "Non-enumerable data properties are unavailable",
          },
        ]);
      if (Array.isArray(item) && !/^(0|[1-9][0-9]*)$/.test(key))
        throw new IRCompileError([
          {
            stage: "parse",
            code: "NON_JSON_OBJECT",
            path,
            message: "Arrays may contain only indexed JSON values",
          },
        ]);
      walk(descriptor.value, depth + 1, `${path}/${key}`);
    }
    if (
      Array.isArray(item) &&
      Object.keys(descriptors).length !== item.length + 1
    )
      throw new IRCompileError([
        {
          stage: "parse",
          code: "NON_JSON_OBJECT",
          path,
          message: "Sparse arrays are unavailable",
        },
      ]);
    active.delete(item);
  }
  walk(value, 0, "");
  const serialized = JSON.stringify(value);
  if (serialized.length > (options.chars ?? IR_LIMITS.planChars))
    throw new IRCompileError([
      {
        stage: "budget",
        code: "JSON_SIZE",
        path: "",
        message: "JSON data exceeds its character budget",
      },
    ]);
}

export const forgeIRSchema = z.preprocess((value, ctx) => {
  try {
    assertIRJson(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid bounded JSON",
    });
    return z.NEVER;
  }
  return value;
}, bareForgeIRSchema);

export const forgeIRJsonSchema = z.toJSONSchema(bareForgeIRSchema, {
  unrepresentable: "any",
}) as JsonSchema;

/** Model-authored plans supply computations, not duplicate encoding contracts.
 * Keep the public/parser schema compatible with callers supplying assertions. */
export const forgeIRGenerationSchema: JsonSchema = (() => {
  const schema = structuredClone(forgeIRJsonSchema);
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as JsonSchema;
    const properties = node.properties as
      Record<string, JsonSchema> | undefined;
    if (properties?.kind?.const === "encode") {
      delete properties.schema;
      if (Array.isArray(node.required))
        node.required = node.required.filter((name) => name !== "schema");
    }
    if (properties?.kind?.const === "literal")
      properties.value = {
        type: ["string", "number", "boolean", "null"],
      };
    if (properties?.kind?.const === "scalar" && properties.args)
      properties.args.minItems = 1;
    if (properties?.kind?.const === "object" && properties.fields)
      properties.fields.minProperties = 1;
    Object.values(node).forEach(visit);
  };
  visit(schema);
  return schema;
})();

export function parseForgeIR(raw: unknown): ForgeIR {
  assertIRJson(raw);
  const parsed = bareForgeIRSchema.safeParse(raw);
  if (!parsed.success)
    throw new IRCompileError(
      parsed.error.issues.map((issue) => ({
        stage: "parse",
        code: "IR_SCHEMA",
        path: "/" + issue.path.join("/"),
        message: issue.message,
      })),
    );
  return parsed.data;
}

/** The code backend must enforce the same finite schema vocabulary as AJV. */
export function assertIREncodingSchema(schema: JsonSchema, path = "/schema") {
  const supported = new Set([
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minItems",
    "maxItems",
    "uniqueItems",
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "enum",
    "const",
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "title",
    "description",
    "default",
    "examples",
    "format",
    "$schema",
    "$id",
    "deprecated",
    "readOnly",
    "writeOnly",
  ]);
  const reject = (here: string, message: string): never => {
    throw new IRCompileError([
      { stage: "type", code: "ENCODE_SCHEMA_UNSUPPORTED", path: here, message },
    ]);
  };
  const walk = (value: unknown, here: string) => {
    if (typeof value === "boolean") return;
    if (!value || typeof value !== "object" || Array.isArray(value))
      reject(
        here,
        "An encoded data schema must be an object or boolean schema",
      );
    const current = value as Record<string, unknown>;
    for (const name of Object.keys(current))
      if (!supported.has(name))
        reject(
          `${here}/${name}`,
          "Encoded data schema uses an unsupported assertion keyword",
        );
    if (current.properties !== undefined) {
      if (
        !current.properties ||
        typeof current.properties !== "object" ||
        Array.isArray(current.properties)
      )
        reject(here + "/properties", "Schema properties must be an object");
      for (const [name, child] of Object.entries(
        current.properties as Record<string, unknown>,
      ))
        walk(child, `${here}/properties/${name}`);
    }
    for (const name of ["items", "additionalProperties", "not"])
      if (current[name] !== undefined) walk(current[name], `${here}/${name}`);
    for (const name of ["anyOf", "oneOf", "allOf"])
      if (current[name] !== undefined) {
        if (!Array.isArray(current[name]))
          reject(`${here}/${name}`, "Schema composition must be an array");
        (current[name] as unknown[]).forEach((child, index) =>
          walk(child, `${here}/${name}/${index}`),
        );
      }
  };
  walk(schema, path);
}
