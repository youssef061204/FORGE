import { describe, expect, it } from "vitest";
import {
  compileIR,
  evaluateIR,
  IRCompileError,
  type ForgeIR,
  type IRExpr,
  type IRCompileEnv,
  type JsonValue,
} from "../src/forge/product/ir";
import type {
  ConnectorDescriptor,
  JsonSchema,
  OperationDescriptor,
  ProgramInput,
} from "../src/forge/product/contracts";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { runProgramExecutable } from "../src/forge/executable";

const lit = (value: JsonValue): IRExpr => ({ kind: "literal", value });
const get = (root: string, ...path: (string | number)[]): IRExpr => ({
  kind: "get",
  root,
  path,
});
const scalar = (
  op: Extract<IRExpr, { kind: "scalar" }>["op"],
  ...args: IRExpr[]
): IRExpr => ({ kind: "scalar", op, args });
const object = (fields: Record<string, IRExpr>): IRExpr => ({
  kind: "object",
  fields,
});
const schema = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const rows = (item: JsonSchema): JsonSchema => ({
  type: "array",
  items: item,
  maxItems: 2000,
});
const input = (
  observations: Record<string, unknown>,
  state: Record<string, unknown> = {},
): ProgramInput => ({
  now: "2032-03-04T10:00:00.000Z",
  input: {},
  state,
  observations,
});
function operation(
  id: string,
  kind: "read" | "write",
  inputSchema: JsonSchema,
  outputSchema: JsonSchema,
): OperationDescriptor {
  return {
    id,
    connector: id.split(".")[0],
    name: id,
    description: "Generic controlled test operation",
    inputSchema,
    outputSchema,
    kind,
    permission: id,
    idempotent: true,
    sideEffect: kind === "read" ? "none" : "reversible",
  };
}
function environment(
  observations: Record<string, JsonSchema>,
  writeSchema = schema({ content: { type: "string" } }),
): IRCompileEnv {
  return {
    reads: Object.keys(observations).map((ref) => ({
      operation: `dataset.${ref}`,
      arguments: {},
      ref,
    })),
    actions: ["archive.store"],
    operations: [
      ...Object.entries(observations).map(([ref, output]) =>
        operation(`dataset.${ref}`, "read", schema({}), output),
      ),
      operation("archive.store", "write", writeSchema, schema({})),
    ],
  };
}
function program(value: IRExpr): ForgeIR {
  return {
    version: "forge-ir/v1",
    bindings: [],
    effects: [
      {
        operation: "archive.store",
        arguments: object({
          content: { kind: "encode", format: "json", value, schema: {} },
        }),
      },
    ],
    result: { summary: lit("Stored the transformed values") },
  };
}
async function run(ir: ForgeIR, env: IRCompileEnv, data: ProgramInput) {
  const fabric = new ConnectorFabric();
  for (const connector of new Set(
    env.operations.map((item) => item.connector),
  )) {
    const descriptor: ConnectorDescriptor = {
      id: connector,
      name: connector,
      kind: "builtin",
      status: "connected",
      mode: "test",
      binding: connector,
      setup: "/inspect",
      constraints: {},
      operations: env.operations.filter((item) => item.connector === connector),
    };
    fabric.register(connector, {
      describe: async () => descriptor,
      invoke: async () => {
        throw new Error("IR tests never invoke connectors");
      },
    });
  }
  await fabric.discover();
  const connectorTypes = fabric.types({
    reads: env.reads,
    actions: [...env.actions],
  });
  const compiled = compileIR(ir, { ...env, connectorTypes });
  const actual = await runProgramExecutable(
    compiled.source,
    data,
    connectorTypes,
  );
  const reference = evaluateIR(ir, data);
  expect(actual).toEqual(reference);
  expect(compiled.source.length).toBeLessThanOrEqual(16000);
  expect(compiled.sourceMap["/result/summary"].offset).toBeGreaterThan(0);
  expect(compiled.compilerVersion).toBe("forge-ir/1.0.0");
  expect(compiled.timings.totalMs).toBeGreaterThanOrEqual(0);
  return { actual, compiled };
}

describe("typed IR lowering through the existing strict compiler and process sandbox", () => {
  it("filters numeric strings, projects fields, sorts stably, and serializes quoted CSV with headers on empty input", async () => {
    const row = schema({
      label: { type: "string" },
      measure: { type: "string" },
    });
    const env = environment({ r0: schema({ values: rows(row) }) });
    const value: IRExpr = {
      kind: "query",
      source: get("observations", "r0", "values"),
      steps: [
        {
          op: "filter",
          as: "sample",
          where: scalar(
            "gt",
            scalar("number", get("sample", "measure")),
            lit(1.5),
          ),
        },
        {
          op: "project",
          as: "sample",
          value: object({
            label: get("sample", "label"),
            metric: scalar("number", get("sample", "measure")),
          }),
        },
        {
          op: "sort",
          as: "sample",
          by: [{ value: get("sample", "metric"), direction: "desc" }],
        },
      ],
    };
    const ir = program(lit(null));
    ir.effects[0].arguments = object({
      content: {
        kind: "encode",
        format: "csv",
        value,
        columns: lit(["label", "metric"]),
        schema: rows(
          schema({ label: { type: "string" }, metric: { type: "number" } }),
        ),
      },
    });
    const result = await run(
      ir,
      env,
      input({
        r0: {
          values: [
            { label: 'North, "A"', measure: "2" },
            { label: "line\nbreak", measure: "2.00" },
            { label: "omit", measure: "1" },
          ],
        },
      }),
    );
    expect(result.actual.operations[0].arguments.content).toBe(
      'label,metric\n"North, ""A""",2\n"line\nbreak",2',
    );
    const empty = await run(ir, env, input({ r0: { values: [] } }));
    expect(empty.actual.operations[0].arguments.content).toBe("label,metric");
    expect(result.compiled.helpers).not.toContain("join");
    expect(result.compiled.helpers).not.toContain("iso");
  });

  it("joins independent typed reads, groups data and builds a dynamic JSON record", async () => {
    const env = environment({
      r0: schema({
        values: rows(
          schema({
            key: { type: "string" },
            category: { type: "string" },
            score: { type: "number" },
          }),
        ),
      }),
      r1: schema({
        values: rows(
          schema({ key: { type: "string" }, enabled: { type: "boolean" } }),
        ),
      }),
    });
    const value: IRExpr = {
      kind: "query",
      source: get("observations", "r0", "values"),
      steps: [
        {
          op: "join",
          right: get("observations", "r1", "values"),
          leftAs: "a",
          rightAs: "b",
          on: scalar("eq", get("a", "key"), get("b", "key")),
          mode: "inner",
        },
        { op: "filter", as: "pair", where: get("pair", "right", "enabled") },
        {
          op: "project",
          as: "pair",
          value: object({
            category: get("pair", "left", "category"),
            score: get("pair", "left", "score"),
          }),
        },
        {
          op: "group",
          as: "sample",
          keys: { category: get("sample", "category") },
          aggregates: {
            total: { op: "sum", value: get("sample", "score") },
            count: { op: "count" },
          },
        },
        {
          op: "record",
          as: "grouped",
          key: get("grouped", "category"),
          value: object({
            total: get("grouped", "total"),
            count: get("grouped", "count"),
          }),
        },
      ],
    };
    const data = input({
      r0: {
        values: [
          { key: "a", category: "x", score: 2 },
          { key: "b", category: "x", score: 3 },
          { key: "c", category: "y", score: 7 },
        ],
      },
      r1: {
        values: [
          { key: "a", enabled: true },
          { key: "b", enabled: true },
          { key: "c", enabled: false },
        ],
      },
    });
    const result = await run(program(value), env, data);
    expect(
      JSON.parse(String(result.actual.operations[0].arguments.content)),
    ).toEqual({ x: { total: 5, count: 2 } });
  });

  it("emits guarded cross-service proposals and bounded state without calling a connector", async () => {
    const env = environment(
      {
        r0: schema({
          values: rows(
            schema({ key: { type: "string" }, enabled: { type: "boolean" } }),
          ),
        }),
      },
      schema({ recipient: { type: "string" }, message: { type: "string" } }),
    );
    env.stateSchema = schema({
      seen: rows({ type: "string" }),
      lastCount: { type: "integer" },
    });
    const collection = get("observations", "r0", "values");
    const ir: ForgeIR = {
      version: "forge-ir/v1",
      bindings: [{ id: "records", value: collection }],
      effects: [
        {
          operation: "archive.store",
          forEach: { source: get("records"), item: "item" },
          when: scalar(
            "and",
            get("item", "enabled"),
            scalar(
              "not",
              scalar("includes", get("state", "seen"), get("item", "key")),
            ),
          ),
          arguments: object({
            recipient: get("item", "key"),
            message: lit("Ready"),
          }),
        },
      ],
      result: { summary: lit("Prepared eligible proposals") },
      state: object({
        seen: {
          kind: "query",
          source: get("records"),
          steps: [
            { op: "project", as: "item", value: get("item", "key") },
            { op: "distinct", as: "item" },
          ],
        },
        lastCount: scalar("length", get("records")),
      }),
    };
    const result = await run(
      ir,
      env,
      input(
        {
          r0: {
            values: [
              { key: "old", enabled: true },
              { key: "new", enabled: true },
              { key: "disabled", enabled: false },
            ],
          },
        },
        { seen: ["old"], lastCount: 0 },
      ),
    );
    expect(result.actual.operations).toEqual([
      {
        operation: "archive.store",
        arguments: { recipient: "new", message: "Ready" },
      },
    ]);
    expect(result.actual.state).toEqual({
      seen: ["old", "new", "disabled"],
      lastCount: 3,
    });
  });

  it("preserves scalar/text/date semantics and evaluates conditional branches lazily", async () => {
    const value = object({
      decimal: scalar("number", lit("-1.25e2")),
      arithmetic: scalar("multiply", scalar("add", lit(3), lit(4)), lit(2)),
      text: scalar(
        "join",
        scalar(
          "split",
          scalar("lower", scalar("trim", lit(" A|B "))),
          lit("|"),
        ),
        lit("/"),
      ),
      date: scalar("dateAddDays", lit("2032-02-28"), lit(1)),
      lazy: scalar(
        "if",
        lit(true),
        lit("kept"),
        scalar("divide", lit(1), lit(0)),
      ),
      entries: scalar("entries", lit({ red: 2, blue: 1 })),
    });
    const result = await run(program(value), environment({}), input({}));
    expect(
      JSON.parse(String(result.actual.operations[0].arguments.content)),
    ).toEqual({
      decimal: -125,
      arithmetic: 14,
      text: "a/b",
      date: "2032-02-29",
      lazy: "kept",
      entries: [
        { key: "red", value: 2 },
        { key: "blue", value: 1 },
      ],
    });
  });

  it("keeps generated names hygienic and source hashes deterministic", () => {
    const ir = program(lit({ note: '"; throw new Error("injected"); //' }));
    ir.bindings = [{ id: "operations", value: lit(4) }];
    const first = compileIR(ir, environment({}));
    const second = compileIR(ir, environment({}));
    expect(first.source).toBe(second.source);
    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.irHash).toBe(second.irHash);
    expect(first.source).not.toContain("const operations:number");
    expect(first.helpers).not.toContain("sort");
  });
});

describe("IR static grounding and failure containment", () => {
  it.each([
    {
      name: "undeclared operation",
      mutate: (ir: ForgeIR) => {
        ir.effects[0].operation = "remote.invented";
      },
      code: "UNDECLARED_OPERATION",
    },
    {
      name: "missing required argument",
      mutate: (ir: ForgeIR) => {
        ir.effects[0].arguments = object({});
      },
      code: "SCHEMA_MISMATCH",
    },
    {
      name: "wrong argument type",
      mutate: (ir: ForgeIR) => {
        ir.effects[0].arguments = object({ content: lit(42) });
      },
      code: "SCHEMA_MISMATCH",
    },
    {
      name: "unknown observation field",
      mutate: (ir: ForgeIR) => {
        ir.effects[0].arguments = object({
          content: get("observations", "r0", "invented"),
        });
      },
      code: "UNKNOWN_FIELD",
    },
    {
      name: "forward binding",
      mutate: (ir: ForgeIR) => {
        ir.bindings = [
          { id: "a", value: get("later") },
          { id: "later", value: lit(1) },
        ];
      },
      code: "UNKNOWN_ROOT",
    },
    {
      name: "root shadowing",
      mutate: (ir: ForgeIR) => {
        ir.bindings = [{ id: "input", value: lit(1) }];
      },
      code: "DUPLICATE_BINDING",
    },
  ])("rejects $name before executable creation", ({ mutate, code }) => {
    const ir = program(lit("value"));
    mutate(ir);
    const env = environment({ r0: schema({ value: { type: "string" } }) });
    try {
      compileIR(ir, env);
      throw new Error("Unexpected success");
    } catch (error) {
      expect(error).toBeInstanceOf(IRCompileError);
      expect((error as IRCompileError).diagnostics[0].code).toBe(code);
    }
  });

  it("rejects wrong literal enum values, reads presented as writes and invented read arguments", () => {
    const env = environment(
      {},
      schema({ content: { type: "string", enum: ["allowed"] } }),
    );
    expect(() => compileIR(program(lit(1)), env)).toThrow(IRCompileError);
    const changed = {
      ...env,
      operations: env.operations.map((operation, index) =>
        index === 0 ? { ...operation, kind: "read" as const } : operation,
      ),
    };
    expect(() => compileIR(program(lit(1)), changed)).toThrow(
      /write operation/,
    );
    const withRead = environment({ r0: schema({ text: { type: "string" } }) });
    withRead.reads[0].arguments = { invented: true };
    expect(() => compileIR(program(lit(1)), withRead)).toThrow(
      /read arguments/,
    );
  });

  it("enforces declared encoded-value constraints before proposing a write", async () => {
    const ir = program(lit(null));
    ir.effects[0].arguments = object({
      content: {
        kind: "encode",
        format: "json",
        value: get("observations", "r0", "n"),
        schema: { type: "number", minimum: 0 },
      },
    });
    const env = environment({ r0: schema({ n: { type: "number" } }) });
    const compiled = compileIR(ir, env);
    expect(() => evaluateIR(ir, input({ r0: { n: -1 } }))).toThrow(
      IRCompileError,
    );
    const types =
      'type ModuleInput={now:string;input:Record<string,unknown>;state:Record<string,unknown>;observations:{r0:{n:number}}};type ModuleOutput={operations:Array<{operation:"archive.store";arguments:{content:string}}>;result:{summary:string;details?:string[]};state?:Record<string,unknown>};';
    await expect(
      runProgramExecutable(compiled.source, input({ r0: { n: -1 } }), types),
    ).rejects.toThrow();
  });

  it("rejects oversized emitted source without weakening the existing executable budget", () => {
    expect(() =>
      compileIR(program(lit("x".repeat(15000))), environment({})),
    ).toThrow(/16000-character/);
  });
});
