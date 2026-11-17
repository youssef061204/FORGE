import type {
  JsonSchema,
  OperationDescriptor,
  ProgramDraft,
} from "./contracts";
import { assertValidSchema, validateJson } from "../contracts/json-schema";
import {
  assertIREncodingSchema,
  IRCompileError,
  IR_RESERVED_ROOTS,
  type ForgeIR,
  type IRExpr,
  type IRStep,
  type JsonValue,
} from "./schema";

export type IRCompileEnv = {
  reads: ProgramDraft["reads"];
  actions: readonly string[];
  operations: readonly OperationDescriptor[];
  stateSchema?: JsonSchema;
  /** Schema for ModuleInput.input, when a tool accepts typed invocation parameters. */
  inputSchema?: JsonSchema;
  /** Exact host-authored Fabric.types(contract) text, for the existing cache. */
  connectorTypes?: string;
};
export type IRAnalysis = {
  schemas: Map<IRExpr, JsonSchema>;
  stepSchemas: Map<IRStep, JsonSchema>;
  roots: Map<string, JsonSchema>;
  inferredOutputSchemas: { operation: string; arguments: JsonSchema }[];
};

function fail(
  code: string,
  path: string,
  message: string,
  expected?: unknown,
  actual?: unknown,
): never {
  throw new IRCompileError([
    {
      stage: "type",
      code,
      path,
      message,
      ...(expected === undefined ? {} : { expected }),
      ...(actual === undefined ? {} : { actual }),
    },
  ]);
}
export function variants(schema: JsonSchema): JsonSchema[] {
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union))
    return union.flatMap((item) => variants(item as JsonSchema));
  if (Array.isArray(schema.type))
    return schema.type.map((type) => ({ ...schema, type }));
  return [schema];
}
export function unionOf(schemas: JsonSchema[]): JsonSchema {
  const flat = schemas.flatMap(variants);
  const unique = [
    ...new Map(flat.map((item) => [JSON.stringify(item), item])).values(),
  ];
  return unique.length === 1 ? unique[0] : { anyOf: unique };
}
export function jsonType(schema: JsonSchema): string | undefined {
  if (typeof schema.type === "string") return schema.type;
  if (schema.const !== undefined)
    return schema.const === null
      ? "null"
      : Array.isArray(schema.const)
        ? "array"
        : typeof schema.const === "number" && Number.isInteger(schema.const)
          ? "integer"
          : typeof schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) {
    const types = [
      ...new Set(
        schema.enum.map((value) =>
          value === null
            ? "null"
            : Array.isArray(value)
              ? "array"
              : typeof value,
        ),
      ),
    ];
    if (types.length === 1) return types[0];
  }
  return typeof schema.type === "string" ? schema.type : undefined;
}
function isType(schema: JsonSchema, types: string[]) {
  return variants(schema).every((item) =>
    types.includes(jsonType(item) ?? "unknown"),
  );
}
function expectType(schema: JsonSchema, types: string[], path: string) {
  if (!isType(schema, types))
    fail(
      "TYPE_MISMATCH",
      path,
      `Expected ${types.join(" or ")}`,
      types,
      schema,
    );
}
function arrayItem(schema: JsonSchema, path: string): JsonSchema {
  expectType(schema, ["array"], path);
  return unionOf(
    variants(schema).map(
      (item) =>
        (item.items && typeof item.items === "object"
          ? item.items
          : {}) as JsonSchema,
    ),
  );
}
function propertyType(
  schema: JsonSchema,
  key: string | number,
  path: string,
): JsonSchema {
  return unionOf(
    variants(schema).flatMap((item): JsonSchema[] => {
      const type = jsonType(item);
      if (type === "null") return [{ type: "null" }];
      if (type === "array") {
        if (typeof key !== "number")
          fail(
            "INVALID_INDEX",
            path,
            "Array paths require a nonnegative numeric index",
          );
        const child =
          item.items && typeof item.items === "object"
            ? (item.items as JsonSchema)
            : {};
        return typeof item.minItems === "number" && item.minItems > key
          ? [child]
          : [child, { type: "null" }];
      }
      if (type !== "object")
        fail(
          "UNKNOWN_PATH",
          path,
          "A path traverses a value without an object/array schema",
          undefined,
          item,
        );
      if (typeof key !== "string")
        fail("INVALID_INDEX", path, "Object paths require a field name");
      const properties = (item.properties ?? {}) as Record<string, JsonSchema>;
      const child = properties[key];
      if (child)
        return (item.required as string[] | undefined)?.includes(key)
          ? [child]
          : [child, { type: "null" }];
      if (
        item.additionalProperties &&
        typeof item.additionalProperties === "object"
      )
        return [item.additionalProperties as JsonSchema, { type: "null" }];
      fail(
        "UNKNOWN_FIELD",
        path,
        `Field ${JSON.stringify(key)} is absent from the connected schema`,
        Object.keys(properties),
        key,
      );
    }),
  );
}
export function literalSchema(value: JsonValue): JsonSchema {
  if (value === null) return { type: "null", const: null };
  if (Array.isArray(value))
    return {
      type: "array",
      items: value.length ? unionOf(value.map(literalSchema)) : {},
      minItems: value.length,
      maxItems: value.length,
    };
  if (typeof value === "object")
    return objectSchema(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, literalSchema(item)]),
      ),
    );
  return {
    type:
      typeof value === "number" && Number.isInteger(value)
        ? "integer"
        : typeof value,
    const: value,
  };
}
function objectSchema(
  properties: Record<string, JsonSchema>,
  additionalProperties: boolean | JsonSchema = false,
): JsonSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties,
  };
}
function sameLiteral(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function compatible(
  actual: JsonSchema,
  expected: JsonSchema | boolean,
): boolean {
  if (typeof expected === "boolean") return expected;
  if (!Object.keys(expected).length) return true;
  const expectedUnion = expected.anyOf ?? expected.oneOf;
  if (Array.isArray(expectedUnion))
    return variants(actual).every((part) =>
      expectedUnion.some((candidate) =>
        compatible(part, candidate as JsonSchema),
      ),
    );
  if (
    Array.isArray(expected.allOf) &&
    !expected.allOf.every((part) => compatible(actual, part as JsonSchema))
  )
    return false;
  return variants(actual).every((part) => {
    const actualType = jsonType(part),
      expectedType = jsonType(expected);
    if (
      expectedType &&
      actualType !== expectedType &&
      !(expectedType === "number" && actualType === "integer")
    )
      return false;
    if (
      expected.const !== undefined &&
      (part.const === undefined || !sameLiteral(part.const, expected.const))
    )
      return false;
    if (Array.isArray(expected.enum)) {
      const values = part.const !== undefined ? [part.const] : part.enum;
      const allowed = expected.enum as unknown[];
      if (
        !Array.isArray(values) ||
        !values.every((value) =>
          allowed.some((candidate: unknown) => sameLiteral(value, candidate)),
        )
      )
        return false;
    }
    if (expectedType === "array") {
      if (part.maxItems === 0) return true;
      return compatible(
        (part.items ?? {}) as JsonSchema,
        (expected.items ?? {}) as JsonSchema,
      );
    }
    if (expectedType === "object") {
      const actualProperties = (part.properties ?? {}) as Record<
        string,
        JsonSchema
      >;
      const expectedProperties = (expected.properties ?? {}) as Record<
        string,
        JsonSchema
      >;
      if (
        (expected.required as string[] | undefined)?.some(
          (key) => !(part.required as string[] | undefined)?.includes(key),
        )
      )
        return false;
      for (const [key, schema] of Object.entries(actualProperties)) {
        const target: unknown = Object.hasOwn(expectedProperties, key)
          ? expectedProperties[key]
          : expected.additionalProperties;
        if (
          target === false ||
          (target === undefined && expected.additionalProperties === false)
        )
          return false;
        if (
          target &&
          typeof target === "object" &&
          !compatible(schema, target as JsonSchema)
        )
          return false;
      }
      if (part.additionalProperties && expected.additionalProperties === false)
        return false;
      if (
        part.additionalProperties &&
        typeof expected.additionalProperties === "object" &&
        !compatible(
          typeof part.additionalProperties === "object"
            ? (part.additionalProperties as JsonSchema)
            : {},
          expected.additionalProperties as JsonSchema,
        )
      )
        return false;
    }
    return true;
  });
}
function requireAssignable(
  actual: JsonSchema,
  expected: JsonSchema,
  path: string,
) {
  if (!compatible(actual, expected))
    fail(
      "SCHEMA_MISMATCH",
      path,
      "Expression does not satisfy the declared schema",
      expected,
      actual,
    );
}

// Schema assertions are enforced again by the emitted, bounded validator.
export function checkOutputSchema(schema: JsonSchema, path: string) {
  assertIREncodingSchema(schema, path);
  try {
    assertValidSchema(schema);
  } catch (error) {
    fail(
      "INVALID_SCHEMA",
      path,
      error instanceof Error ? error.message : "Invalid JSON Schema",
    );
  }
}

/** Infer the serializable type envelope, rather than copying arbitrary
 * connector assertions into executable source. Unsupported constraints (such
 * as regexes and references) remain the host connector's responsibility.
 * A oneOf becomes a type union: removing an unsupported discriminator must not
 * accidentally introduce a new exclusivity assertion. Explicit encode.schema
 * still follows the unchanged, strict assertion-validation path. */
function inferredEncodingSchema(schema: JsonSchema): JsonSchema {
  const branches = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(branches))
    return {
      anyOf: branches.map((part) => inferredEncodingSchema(part as JsonSchema)),
    };
  const inferred: JsonSchema = {};
  for (const key of [
    "type",
    "const",
    "enum",
    "required",
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
  ])
    if (schema[key] !== undefined) inferred[key] = structuredClone(schema[key]);
  if (schema.properties && typeof schema.properties === "object")
    inferred.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, JsonSchema>).map(
        ([name, child]) => [name, inferredEncodingSchema(child)],
      ),
    );
  for (const key of ["items", "additionalProperties"]) {
    const child = schema[key];
    if (typeof child === "boolean") inferred[key] = child;
    else if (child && typeof child === "object" && !Array.isArray(child))
      inferred[key] = inferredEncodingSchema(child as JsonSchema);
  }
  return inferred;
}

export function analyzeIR(ir: ForgeIR, env: IRCompileEnv): IRAnalysis {
  const operations = new Map(
    env.operations.map((operation) => [operation.id, operation]),
  );
  if (operations.size !== env.operations.length)
    fail("DUPLICATE_OPERATION", "/operations", "Operation IDs must be unique");
  if (new Set(env.reads.map((read) => read.ref)).size !== env.reads.length)
    fail("DUPLICATE_REF", "/reads", "Observation refs must be unique");
  const observationProperties: Record<string, JsonSchema> = {};
  for (const [index, read] of env.reads.entries()) {
    const operation = operations.get(read.operation);
    if (!operation || operation.kind !== "read")
      fail(
        "UNKNOWN_READ",
        `/reads/${index}`,
        "A declared observation must name an available read operation",
      );
    try {
      validateJson(operation.inputSchema, read.arguments, "IR read arguments");
    } catch (error) {
      fail("READ_ARGUMENTS", `/reads/${index}/arguments`, String(error));
    }
    observationProperties[read.ref] = operation.outputSchema;
  }
  for (const [index, id] of env.actions.entries())
    if (operations.get(id)?.kind !== "write")
      fail(
        "UNKNOWN_ACTION",
        `/actions/${index}`,
        "A declared action must name an available write operation",
      );
  if (new Set(env.actions).size !== env.actions.length)
    fail("DUPLICATE_ACTION", "/actions", "Action IDs must be unique");
  const parameters = env.inputSchema ?? {
    type: "object",
    additionalProperties: true,
  };
  const state = env.stateSchema ?? {
    type: "object",
    additionalProperties: true,
  };
  const observations = objectSchema(observationProperties);
  const roots = new Map<string, JsonSchema>([
    ["now", { type: "string" }],
    ["params", parameters],
    ["state", state],
    ["observations", observations],
    [
      "input",
      objectSchema({
        now: { type: "string" },
        input: parameters,
        state,
        observations,
      }),
    ],
  ]);
  const schemas = new Map<IRExpr, JsonSchema>(),
    stepSchemas = new Map<IRStep, JsonSchema>();
  const inferredOutputSchemas: IRAnalysis["inferredOutputSchemas"] = [];
  function scopeWith(
    scope: Map<string, JsonSchema>,
    name: string,
    schema: JsonSchema,
    path: string,
  ) {
    if (
      scope.has(name) ||
      (IR_RESERVED_ROOTS as readonly string[]).includes(name)
    )
      fail(
        "SHADOWED_BINDING",
        path,
        `Binding ${JSON.stringify(name)} shadows an existing root`,
      );
    return new Map([...scope, [name, schema]]);
  }
  function expression(
    expr: IRExpr,
    scope: Map<string, JsonSchema>,
    path: string,
  ): JsonSchema {
    let schema: JsonSchema;
    switch (expr.kind) {
      case "literal":
        schema = literalSchema(expr.value);
        break;
      case "get": {
        const root = scope.get(expr.root);
        if (!root)
          fail(
            "UNKNOWN_ROOT",
            `${path}/root`,
            `Unknown or forward root ${JSON.stringify(expr.root)}`,
          );
        schema = root;
        for (const [index, key] of expr.path.entries())
          schema = propertyType(schema, key, `${path}/path/${index}`);
        break;
      }
      case "object":
        schema = objectSchema(
          Object.fromEntries(
            Object.entries(expr.fields).map(([key, value]) => [
              key,
              expression(value, scope, `${path}/fields/${key}`),
            ]),
          ),
        );
        break;
      case "array":
        schema = {
          type: "array",
          items: expr.items.length
            ? unionOf(
                expr.items.map((value, index) =>
                  expression(value, scope, `${path}/items/${index}`),
                ),
              )
            : {},
          minItems: expr.items.length,
          maxItems: expr.items.length,
        };
        break;
      case "scalar": {
        const args = expr.args.map((arg, index) =>
          expression(arg, scope, `${path}/args/${index}`),
        );
        const count = (minimum: number, maximum = minimum) => {
          if (args.length < minimum || args.length > maximum)
            fail(
              "ARITY",
              path,
              `${expr.op} expects ${minimum}${maximum !== minimum ? `..${maximum}` : ""} arguments`,
            );
        };
        const all = (types: string[]) =>
          args.forEach((arg, index) =>
            expectType(arg, types, `${path}/args/${index}`),
          );
        switch (expr.op) {
          case "number":
            count(1);
            all(["string", "number", "integer"]);
            schema = { type: "number" };
            break;
          case "string":
            count(1);
            all(["string", "number", "integer", "boolean", "null"]);
            schema = { type: "string" };
            break;
          case "trim":
          case "lower":
          case "upper":
          case "isoDate":
            count(1);
            all(["string"]);
            schema = { type: "string" };
            break;
          case "concat":
            count(1, 32);
            all(["string"]);
            schema = { type: "string" };
            break;
          case "split":
            count(2);
            all(["string"]);
            schema = { type: "array", items: { type: "string" } };
            break;
          case "join":
            count(2);
            expectType(arrayItem(args[0], path), ["string"], path);
            expectType(args[1], ["string"], path);
            schema = { type: "string" };
            break;
          case "length":
            count(1);
            all(["string", "array"]);
            schema = { type: "integer", minimum: 0 };
            break;
          case "add":
          case "multiply":
            count(2);
            all(["number", "integer"]);
            schema = {
              type: args.every((arg) => isType(arg, ["integer"]))
                ? "integer"
                : "number",
            };
            break;
          case "subtract":
          case "divide":
          case "modulo":
            count(2);
            all(["number", "integer"]);
            schema = {
              type:
                expr.op !== "divide" &&
                args.every((arg) => isType(arg, ["integer"]))
                  ? "integer"
                  : "number",
            };
            break;
          case "round":
            count(1);
            all(["number", "integer"]);
            schema = { type: "integer" };
            break;
          case "floor":
            count(1);
            all(["number", "integer"]);
            schema = { type: "integer" };
            break;
          case "abs":
            count(1);
            all(["number", "integer"]);
            schema = {
              type: isType(args[0], ["integer"]) ? "integer" : "number",
            };
            break;
          case "min":
          case "max":
            count(1, 32);
            if (args.length === 1 && isType(args[0], ["array"]))
              expectType(arrayItem(args[0], path), ["number", "integer"], path);
            else all(["number", "integer"]);
            schema = { type: ["number", "null"] };
            break;
          case "sum":
            count(1);
            expectType(arrayItem(args[0], path), ["number", "integer"], path);
            schema = { type: "number" };
            break;
          case "eq":
          case "ne":
            count(2);
            schema = { type: "boolean" };
            break;
          case "lt":
          case "lte":
          case "gt":
          case "gte":
            count(2);
            all(["string", "number", "integer"]);
            if (isType(args[0], ["string"]) !== isType(args[1], ["string"]))
              fail(
                "TYPE_MISMATCH",
                path,
                "Comparison operands must both be strings or both numbers",
              );
            schema = { type: "boolean" };
            break;
          case "and":
          case "or":
            count(1, 32);
            all(["boolean"]);
            schema = { type: "boolean" };
            break;
          case "not":
            count(1);
            all(["boolean"]);
            schema = { type: "boolean" };
            break;
          case "if":
            count(3);
            expectType(args[0], ["boolean"], path);
            schema = unionOf(args.slice(1));
            break;
          case "coalesce":
            count(1, 32);
            schema = unionOf([
              ...args
                .slice(0, -1)
                .flatMap(variants)
                .filter((arg) => jsonType(arg) !== "null"),
              args.at(-1)!,
            ]);
            break;
          case "isNull":
            count(1);
            schema = { type: "boolean" };
            break;
          case "includes":
            count(2);
            expectType(args[0], ["string", "array"], path);
            if (isType(args[0], ["string"]))
              expectType(args[1], ["string"], path);
            schema = { type: "boolean" };
            break;
          case "startsWith":
          case "endsWith":
            count(2);
            all(["string"]);
            schema = { type: "boolean" };
            break;
          case "slice":
            count(2, 3);
            expectType(args[0], ["string", "array"], path);
            args.slice(1).forEach((arg) => expectType(arg, ["integer"], path));
            schema = unionOf(
              variants(args[0]).map((part) =>
                jsonType(part) === "string"
                  ? { type: "string" }
                  : {
                      type: "array",
                      items: part.items ?? {},
                      minItems: 0,
                      ...(typeof part.maxItems === "number"
                        ? { maxItems: part.maxItems }
                        : {}),
                    },
              ),
            );
            break;
          case "replace":
            count(3);
            all(["string"]);
            schema = { type: "string" };
            break;
          case "dateAddDays":
            count(2);
            expectType(args[0], ["string"], path);
            expectType(args[1], ["integer"], path);
            schema = { type: "string" };
            break;
          case "keys":
          case "values":
          case "entries": {
            count(1);
            expectType(args[0], ["object"], path);
            const values = variants(args[0]).flatMap((part) => [
              ...Object.values(
                (part.properties ?? {}) as Record<string, JsonSchema>,
              ),
              ...(part.additionalProperties &&
              typeof part.additionalProperties === "object"
                ? [part.additionalProperties as JsonSchema]
                : []),
            ]);
            const value = values.length ? unionOf(values) : {};
            schema = {
              type: "array",
              items:
                expr.op === "keys"
                  ? { type: "string" }
                  : expr.op === "values"
                    ? value
                    : objectSchema({ key: { type: "string" }, value }),
            };
            break;
          }
        }
        break;
      }
      case "query": {
        schema = expression(expr.source, scope, `${path}/source`);
        for (const [index, step] of expr.steps.entries()) {
          const at = `${path}/steps/${index}`,
            row = arrayItem(schema, at);
          const rowScope = (name: string) => scopeWith(scope, name, row, at);
          switch (step.op) {
            case "filter":
              expectType(
                expression(step.where, rowScope(step.as), `${at}/where`),
                ["boolean"],
                at,
              );
              schema = { ...schema, minItems: 0 };
              break;
            case "project":
              schema = {
                type: "array",
                items: expression(step.value, rowScope(step.as), `${at}/value`),
              };
              break;
            case "flatMap":
              schema = {
                type: "array",
                items: arrayItem(
                  expression(step.value, rowScope(step.as), `${at}/value`),
                  at,
                ),
              };
              break;
            case "join": {
              const right = arrayItem(
                expression(step.right, scope, `${at}/right`),
                at,
              );
              const on = scopeWith(
                scopeWith(scope, step.leftAs, row, at),
                step.rightAs,
                right,
                at,
              );
              expectType(expression(step.on, on, `${at}/on`), ["boolean"], at);
              schema = {
                type: "array",
                items: objectSchema({
                  left: row,
                  right:
                    step.mode === "left"
                      ? unionOf([right, { type: "null" }])
                      : right,
                }),
              };
              break;
            }
            case "group": {
              const inner = rowScope(step.as),
                fields: Record<string, JsonSchema> = {};
              for (const [key, value] of Object.entries(step.keys)) {
                const type = expression(value, inner, `${at}/keys/${key}`);
                expectType(
                  type,
                  ["string", "number", "integer", "boolean", "null"],
                  at,
                );
                fields[key] = type;
              }
              for (const [key, aggregate] of Object.entries(step.aggregates)) {
                if (fields[key])
                  fail(
                    "DUPLICATE_FIELD",
                    at,
                    "Group keys and aggregate names must be disjoint",
                  );
                if (aggregate.op === "count")
                  fields[key] = { type: "integer", minimum: 0 };
                else {
                  const type = expression(
                    aggregate.value,
                    inner,
                    `${at}/aggregates/${key}/value`,
                  );
                  if (["sum", "min", "max", "mean"].includes(aggregate.op))
                    expectType(type, ["number", "integer"], at);
                  fields[key] =
                    aggregate.op === "collect"
                      ? { type: "array", items: type }
                      : aggregate.op === "first" || aggregate.op === "last"
                        ? type
                        : { type: "number" };
                }
              }
              schema = { type: "array", items: objectSchema(fields) };
              break;
            }
            case "distinct":
              if (step.by) expression(step.by, rowScope(step.as), `${at}/by`);
              schema = { ...schema, minItems: 0 };
              break;
            case "sort":
              for (const [key, order] of step.by.entries()) {
                const type = expression(
                  order.value,
                  rowScope(step.as),
                  `${at}/by/${key}/value`,
                );
                expectType(type, ["string", "number", "integer", "null"], at);
                const nonNull = variants(type).filter(
                  (part) => jsonType(part) !== "null",
                );
                if (
                  nonNull.length &&
                  isType(nonNull[0], ["string"]) !==
                    isType(unionOf(nonNull), ["string"])
                )
                  fail(
                    "TYPE_MISMATCH",
                    at,
                    "Sort values must have one comparable scalar type",
                  );
              }
              break;
            case "slice":
              schema = { ...schema, minItems: 0, maxItems: step.limit };
              break;
            case "record": {
              if (index !== expr.steps.length - 1)
                fail(
                  "TERMINAL_RECORD",
                  at,
                  "Record conversion must be the final query step",
                );
              const inner = rowScope(step.as);
              expectType(
                expression(step.key, inner, `${at}/key`),
                ["string"],
                at,
              );
              schema = objectSchema(
                {},
                expression(step.value, inner, `${at}/value`),
              );
              break;
            }
          }
          stepSchemas.set(step, schema);
        }
        break;
      }
      case "encode": {
        const value = expression(expr.value, scope, `${path}/value`);
        // Normalize the parsed tree before emission/hash/metadata publication.
        // The public compile entry point owns this parsed copy, not caller IR.
        expr.schema ??= inferredEncodingSchema(value);
        checkOutputSchema(expr.schema, `${path}/schema`);
        requireAssignable(value, expr.schema, `${path}/value`);
        if (expr.format === "csv") {
          const row = arrayItem(value, path);
          expectType(row, ["object"], path);
          if (!expr.columns)
            fail(
              "CSV_COLUMNS",
              path,
              "CSV encoding requires explicit ordered columns",
            );
          expectType(
            arrayItem(expression(expr.columns, scope, `${path}/columns`), path),
            ["string"],
            path,
          );
        } else if (expr.columns)
          fail("ENCODING_COLUMNS", path, "Only CSV encoding accepts columns");
        if (expr.format === "text") {
          expectType(value, ["string", "array"], path);
          for (const part of variants(value).filter(
            (part) => jsonType(part) === "array",
          ))
            expectType(arrayItem(part, path), ["string"], path);
        }
        schema = { type: "string" };
        break;
      }
    }
    schemas.set(expr, schema);
    return schema;
  }
  for (const [index, binding] of ir.bindings.entries()) {
    if (roots.has(binding.id))
      fail(
        "DUPLICATE_BINDING",
        `/bindings/${index}`,
        "Binding IDs must be unique and cannot shadow reserved roots",
      );
    roots.set(
      binding.id,
      expression(binding.value, roots, `/bindings/${index}/value`),
    );
  }
  for (const [index, effect] of ir.effects.entries()) {
    const path = `/effects/${index}`,
      operation = operations.get(effect.operation);
    if (
      !operation ||
      operation.kind !== "write" ||
      !env.actions.includes(effect.operation)
    )
      fail(
        "UNDECLARED_OPERATION",
        path,
        "Effects may use only declared available write operations",
        env.actions,
        effect.operation,
      );
    const inner = effect.forEach
      ? scopeWith(
          roots,
          effect.forEach.item,
          arrayItem(
            expression(effect.forEach.source, roots, `${path}/forEach/source`),
            path,
          ),
          path,
        )
      : roots;
    if (effect.when)
      expectType(
        expression(effect.when, inner, `${path}/when`),
        ["boolean"],
        path,
      );
    const args = expression(effect.arguments, inner, `${path}/arguments`);
    requireAssignable(args, operation.inputSchema, `${path}/arguments`);
    if (effect.arguments.kind === "literal") {
      try {
        validateJson(
          operation.inputSchema,
          effect.arguments.value,
          "IR effect arguments",
        );
      } catch (error) {
        fail("EFFECT_ARGUMENTS", path, String(error));
      }
    }
    inferredOutputSchemas.push({
      operation: effect.operation,
      arguments: args,
    });
  }
  expectType(
    expression(ir.result.summary, roots, "/result/summary"),
    ["string"],
    "/result/summary",
  );
  if (ir.result.details)
    expectType(
      arrayItem(
        expression(ir.result.details, roots, "/result/details"),
        "/result/details",
      ),
      ["string"],
      "/result/details",
    );
  if (ir.state) {
    const stateType = expression(ir.state, roots, "/state");
    expectType(stateType, ["object"], "/state");
    if (env.stateSchema)
      requireAssignable(stateType, env.stateSchema, "/state");
  }
  return { schemas, stepSchemas, roots, inferredOutputSchemas };
}
