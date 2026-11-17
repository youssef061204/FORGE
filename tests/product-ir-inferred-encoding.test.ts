import { describe, expect, it } from "vitest";
import {
  compileIR,
  evaluateIR,
  forgeIRGenerationSchema,
  forgeIRJsonSchema,
  IRCompileError,
  type ForgeIR,
  type IRCompileEnv,
  type IRExpr,
  type JsonValue,
} from "../src/forge/product/ir";
import { parseForgeIR } from "../src/forge/product/ir-schema";
import type {
  ConnectorDescriptor,
  JsonSchema,
  OperationDescriptor,
  ProgramInput,
} from "../src/forge/product/contracts";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { runProgramExecutable } from "../src/forge/executable";
import { digest } from "../src/forge/hash";
import { validateJson } from "../src/forge/product/schemas";

const literal = (value: JsonValue): IRExpr => ({ kind: "literal", value });
const get = (...path: string[]): IRExpr => ({
  kind: "get",
  root: "observations",
  path: ["r0", ...path],
});
const objectSchema = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const rowSchema = objectSchema({
  label: { type: "string", minLength: 1 },
  amount: { type: "number", minimum: 0 },
});
const rowsSchema: JsonSchema = {
  type: "array",
  items: rowSchema,
  maxItems: 50,
};
const data = (rows: unknown): ProgramInput => ({
  now: "2026-11-16T00:00:00.000Z",
  input: {},
  observations: { r0: { rows } },
  state: {},
});
const program = (encoding: IRExpr): ForgeIR => ({
  version: "forge-ir/v1",
  bindings: [],
  effects: [
    {
      operation: "archive.store",
      arguments: { kind: "object", fields: { content: encoding } },
    },
  ],
  result: { summary: literal("Stored the result") },
});
const encode = (
  format: "json" | "csv" | "text" = "json",
  value = get("rows"),
): Extract<IRExpr, { kind: "encode" }> => ({ kind: "encode", format, value });
function encodingOf(ir: ForgeIR): Extract<IRExpr, { kind: "encode" }> {
  const args = ir.effects[0].arguments;
  if (args.kind !== "object" || args.fields.content.kind !== "encode")
    throw new Error("Test fixture requires an encoding effect");
  return args.fields.content;
}
async function environment(outputSchema = objectSchema({ rows: rowsSchema })) {
  const operation = (
    id: string,
    kind: "read" | "write",
    inputSchema: JsonSchema,
    output: JsonSchema,
  ): OperationDescriptor => ({
    id,
    name: id,
    connector: id.split(".")[0],
    description: "Controlled local IR test operation",
    kind,
    permission: id,
    sideEffect: kind === "read" ? "none" : "reversible",
    idempotent: true,
    inputSchema,
    outputSchema: output,
  });
  const env: IRCompileEnv = {
    reads: [{ operation: "dataset.read", arguments: {}, ref: "r0" }],
    actions: ["archive.store"],
    operations: [
      operation("dataset.read", "read", objectSchema({}), outputSchema),
      operation(
        "archive.store",
        "write",
        objectSchema({ content: { type: "string" } }),
        objectSchema({}),
      ),
    ],
  };
  const fabric = new ConnectorFabric();
  for (const id of ["dataset", "archive"]) {
    const descriptor: ConnectorDescriptor = {
      id,
      name: id,
      kind: "builtin",
      status: "connected",
      mode: "test",
      binding: id,
      setup: "/inspect",
      constraints: {},
      operations: env.operations.filter((op) => op.connector === id),
    };
    fabric.register(id, {
      describe: async () => descriptor,
      invoke: async () => {
        throw new Error("This fixture cannot invoke connectors");
      },
    });
  }
  await fabric.discover();
  env.connectorTypes = fabric.types({
    reads: env.reads,
    actions: [...env.actions],
  });
  return env;
}

describe("compiler-inferred IR encoding contracts", () => {
  it("separates model generation grammar from the compatible public parser", () => {
    const omitted = program(encode());
    const explicit = program({ ...encode(), schema: rowsSchema });
    expect(() =>
      validateJson(forgeIRGenerationSchema, omitted, "generated IR"),
    ).not.toThrow();
    expect(() =>
      validateJson(forgeIRJsonSchema, omitted, "public IR"),
    ).not.toThrow();
    expect(() =>
      validateJson(forgeIRJsonSchema, explicit, "public IR"),
    ).not.toThrow();
    expect(() =>
      validateJson(forgeIRGenerationSchema, explicit, "generated IR"),
    ).toThrow();
    expect(parseForgeIR(explicit)).toEqual(explicit);
    expect(JSON.stringify(forgeIRGenerationSchema).length).toBeLessThan(20000);
  });

  it("normalizes inferred schemas before hashing and lowering without mutating caller IR", async () => {
    const ir = program(encode());
    const before = structuredClone(ir);
    const env = await environment();
    const compiled = compileIR(ir, env);
    expect(encodingOf(compiled.ir).schema).toEqual(rowsSchema);
    expect(ir).toEqual(before);
    expect(encodingOf(ir).schema).toBeUndefined();
    expect(compiled.irHash).toBe(digest(compiled.ir));
    expect(compiled.irHash).not.toBe(digest(ir));
    expect(compiled.source).toContain(
      JSON.stringify(encodingOf(compiled.ir).schema),
    );
    expect(compiled.source.length).toBeLessThanOrEqual(16000);
    for (const rows of [
      [{ label: "sample", amount: 2.75 }],
      [
        { label: "new observation", amount: 19 },
        { label: "zero", amount: 0 },
      ],
      [],
    ]) {
      const actual = await runProgramExecutable(
        compiled.source,
        data(rows),
        env.connectorTypes!,
      );
      expect(actual).toEqual(evaluateIR(ir, data(rows)));
      expect(actual.operations[0].arguments.content).toBe(JSON.stringify(rows));
    }
  });

  it("infers projected CSV row types and preserves quoting, header order and empty headers", async () => {
    const value: IRExpr = {
      kind: "query",
      source: get("rows"),
      steps: [
        {
          op: "project",
          as: "row",
          value: {
            kind: "object",
            fields: {
              name: { kind: "get", root: "row", path: ["label"] },
              doubled: {
                kind: "scalar",
                op: "multiply",
                args: [
                  { kind: "get", root: "row", path: ["amount"] },
                  literal(2),
                ],
              },
            },
          },
        },
      ],
    };
    const ir = program({
      ...encode("csv", value),
      columns: literal(["doubled", "name"]),
      terminalNewline: true,
    });
    const env = await environment();
    const compiled = compileIR(ir, env);
    expect(encodingOf(compiled.ir).schema).toEqual({
      type: "array",
      items: objectSchema({
        name: { type: "string", minLength: 1 },
        doubled: { type: "number" },
      }),
    });
    for (const [rows, expected] of [
      [
        [{ label: 'quoted, "cell"', amount: 4 }],
        'doubled,name\n8,"quoted, ""cell"""\n',
      ],
      [[], "doubled,name\n"],
    ] as const) {
      const actual = await runProgramExecutable(
        compiled.source,
        data(rows),
        env.connectorTypes!,
      );
      expect(actual).toEqual(evaluateIR(ir, data(rows)));
      expect(actual.operations[0].arguments.content).toBe(expected);
    }
  });

  it("infers text array contracts without changing terminal newline behavior", async () => {
    const ir = program({
      ...encode("text", literal(["first", "second"])),
      terminalNewline: true,
    });
    const env = await environment();
    const compiled = compileIR(ir, env);
    const actual = await runProgramExecutable(
      compiled.source,
      data([]),
      env.connectorTypes!,
    );
    expect(actual).toEqual(evaluateIR(ir, data([])));
    expect(actual.operations[0].arguments.content).toBe("first\nsecond\n");
  });

  it("infers a type union without transferring unsupported connector regex assertions", async () => {
    const hostSchema = {
      oneOf: [
        { type: "string", pattern: "^alpha" },
        { type: "string", pattern: "^beta" },
      ],
    };
    const env = await environment(objectSchema({ rows: hostSchema }));
    const ir = program(encode());
    const compiled = compileIR(ir, env);
    expect(encodingOf(compiled.ir).schema).toEqual({
      anyOf: [{ type: "string" }, { type: "string" }],
    });
    const actual = await runProgramExecutable(
      compiled.source,
      data("alpha-value"),
      env.connectorTypes!,
    );
    expect(actual).toEqual(evaluateIR(ir, data("alpha-value")));
  });

  it("preserves explicit schema rejection and typed field checks", async () => {
    const env = await environment();
    for (const schema of [
      { type: "number" },
      { type: "array", dependentRequired: { arbitrary: ["field"] } },
      { type: "array", items: { type: "string", pattern: "(a+)+$" } },
    ])
      expect(() => compileIR(program({ ...encode(), schema }), env)).toThrow(
        IRCompileError,
      );
    expect(() =>
      compileIR(program(encode("json", get("missing"))), env),
    ).toThrow(/absent from the connected schema/);
    expect(() => compileIR(program(encode("text", get("rows"))), env)).toThrow(
      /Expected string/,
    );
  });

  it("enforces explicit runtime bounds in both backends", async () => {
    const ir = program({ ...encode(), schema: { ...rowsSchema, maxItems: 1 } });
    const env = await environment();
    const compiled = compileIR(ir, env);
    expect(encodingOf(compiled.ir).schema?.maxItems).toBe(1);
    const valid = data([{ label: "one", amount: 1 }]);
    expect(
      await runProgramExecutable(compiled.source, valid, env.connectorTypes!),
    ).toEqual(evaluateIR(ir, valid));
    const invalid = data([
      { label: "one", amount: 1 },
      { label: "two", amount: 2 },
    ]);
    expect(() => evaluateIR(ir, invalid)).toThrow(/declared data schema/);
    await expect(
      runProgramExecutable(compiled.source, invalid, env.connectorTypes!),
    ).rejects.toThrow();
  });

  it("keeps raw schema-free evaluation finite, format-safe and bounded", () => {
    expect(() =>
      evaluateIR(program(encode()), data([{ label: "invalid", amount: NaN }])),
    ).toThrow(/finite JSON/);
    expect(() =>
      evaluateIR(
        program(
          encode("json", {
            kind: "scalar",
            op: "divide",
            args: [literal(1), literal(0)],
          }),
        ),
        data([]),
      ),
    ).toThrow(/finite|zero/);
    expect(() =>
      evaluateIR(
        program({ ...encode("csv"), columns: literal(["label", "label"]) }),
        data([]),
      ),
    ).toThrow(/distinct/);
    expect(() =>
      evaluateIR(
        program({ ...encode("csv"), columns: literal(["missing"]) }),
        data([{ label: "x", amount: 1 }]),
      ),
    ).toThrow(/missing a selected column/);
    expect(() =>
      evaluateIR(
        program({ ...encode("csv"), columns: literal(["label"]) }),
        data([null]),
      ),
    ).toThrow(/object/);
    expect(() =>
      evaluateIR(
        program(encode()),
        data(Array(1001).fill({ label: "x", amount: 1 })),
      ),
    ).toThrow(/row budget/);
    expect(() =>
      evaluateIR(
        program(
          encode("json", { kind: "get", root: "params", path: ["large"] }),
        ),
        { ...data([]), input: { large: "x".repeat(8192) } },
      ),
    ).toThrow(/budget/);
  });
});
