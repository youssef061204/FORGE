import { describe, expect, it } from "vitest";
import { evaluateIR } from "../../src/core/ir/evaluate";
import {
  forgeIRJsonSchema,
  forgeIRSchema,
  IRCompileError,
  parseForgeIR,
  type ForgeIR,
  type IRExpr,
  type IRScalarName,
  type JsonValue,
} from "../../src/core/ir/schema";
import type { ProgramInput } from "../../src/core/ir/contracts";
import { validateJson } from "../../src/core/contracts/json-schema";

const literal = (value: JsonValue): IRExpr => ({ kind: "literal", value });
const get = (root: string, ...path: (string | number)[]): IRExpr => ({
  kind: "get",
  root,
  path,
});
const scalar = (op: IRScalarName, ...args: IRExpr[]): IRExpr => ({
  kind: "scalar",
  op,
  args,
});
const object = (fields: Record<string, IRExpr>): IRExpr => ({
  kind: "object",
  fields,
});
const input = (
  observations: Record<string, unknown> = {},
  params: Record<string, unknown> = {},
  state: Record<string, unknown> = {},
): ProgramInput => ({
  now: "2026-11-14T00:00:00.000Z",
  input: params,
  state,
  observations,
});
const program = (value: IRExpr): ForgeIR => ({
  version: "forge-ir/v1",
  bindings: [],
  effects: [],
  result: { summary: literal("Computed a bounded result") },
  state: object({ value }),
});
const valueOf = (value: IRExpr, data: ProgramInput = input()) =>
  evaluateIR(program(value), data).state.value;

describe("bounded IR schema and pure reference evaluator", () => {
  it("exports a serializable recursive generation schema matching a real program", () => {
    const plan = program(scalar("add", literal(4), literal(9)));
    const serialized = JSON.stringify(forgeIRJsonSchema);
    expect(serialized.length).toBeLessThan(20000);
    expect(() =>
      validateJson(JSON.parse(serialized), plan, "IR"),
    ).not.toThrow();
    expect(forgeIRSchema.parse(plan)).toEqual(plan);
    expect(valueOf(scalar("add", literal(4), literal(9)))).toBe(13);
  });

  it("rejects unknown instructions, raw source and unsafe prototype paths", () => {
    expect(() =>
      parseForgeIR({ ...program(literal(0)), source: "arbitrary code" }),
    ).toThrow(IRCompileError);
    expect(() =>
      parseForgeIR(
        program({ kind: "get", root: "params", path: ["constructor"] }),
      ),
    ).toThrow(IRCompileError);
    expect(() =>
      parseForgeIR(
        JSON.parse(
          '{"version":"forge-ir/v1","bindings":[],"effects":[],"result":{"summary":{"kind":"literal","value":"x"}},"__proto__":{}}',
        ),
      ),
    ).toThrow(IRCompileError);
  });

  it("rejects cycles, accessors and non-JSON literals before recursive parsing", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => parseForgeIR(cycle)).toThrow(/Cyclic/);
    let accessed = false;
    const accessor = {
      get value() {
        accessed = true;
        return 1;
      },
    };
    expect(() => parseForgeIR(accessor)).toThrow(/Accessor/);
    expect(accessed).toBe(false);
    const hidden = Object.defineProperty({}, "hidden", { value: 1 });
    expect(() => parseForgeIR(hidden)).toThrow(/Non-enumerable/);
    expect(() => parseForgeIR(program(literal(Number.NaN)))).toThrow(
      /finite JSON/,
    );
    expect(() =>
      parseForgeIR(program(literal(new Date() as unknown as JsonValue))),
    ).toThrow(/ordinary JSON/);
    const sparse = Array(2) as JsonValue[];
    expect(() => parseForgeIR(program(literal(sparse)))).toThrow(/Sparse/);
  });

  it("uses ordered bindings and host roots while rejecting forward references and shadowing", () => {
    const plan = program(scalar("add", get("first"), get("second")));
    plan.bindings = [
      { id: "first", value: get("params", "start") },
      { id: "second", value: scalar("multiply", get("first"), literal(3)) },
    ];
    expect(evaluateIR(plan, input({}, { start: 5 })).state.value).toBe(20);
    expect(valueOf(get("input", "now"))).toBe("2026-11-14T00:00:00.000Z");
    expect(valueOf(get("state", "missing", "value"))).toBeNull();
    expect(() =>
      evaluateIR(
        { ...plan, bindings: [...plan.bindings].reverse() },
        input({}, { start: 5 }),
      ),
    ).toThrow(/Root first is unavailable/);
    expect(() =>
      evaluateIR(
        { ...plan, bindings: [{ id: "input", value: literal(2) }] },
        input(),
      ),
    ).toThrow(/may not replace/);
    expect(() =>
      valueOf({
        kind: "query",
        source: literal([1]),
        steps: [{ op: "project", as: "input", value: literal(1) }],
      }),
    ).toThrow(/shadow/);
  });

  it("distinguishes missing properties from invalid path kinds", () => {
    expect(valueOf(get("params", "optional"))).toBeNull();
    expect(
      valueOf(get("params", "values", 10), input({}, { values: [2] })),
    ).toBeNull();
    expect(() =>
      valueOf(get("params", "values", "0"), input({}, { values: [2] })),
    ).toThrow(/numeric indices/);
    expect(() =>
      valueOf(get("params", "record", 0), input({}, { record: { field: 2 } })),
    ).toThrow(/named fields/);
    expect(() =>
      valueOf(get("params", "scalar", "field"), input({}, { scalar: 2 })),
    ).toThrow(/scalar value/);
  });

  it("filters, projects and numerically sorts with stable ties without mutating input", () => {
    const data = input({
      source: {
        rows: [
          { label: "beta", score: "12", active: true },
          { label: "alpha", score: "2", active: false },
          { label: "gamma", score: "12", active: true },
        ],
      },
    });
    const before = JSON.stringify(data);
    const expression: IRExpr = {
      kind: "query",
      source: get("observations", "source", "rows"),
      steps: [
        { op: "filter", as: "row", where: get("row", "active") },
        {
          op: "project",
          as: "row",
          value: object({
            label: get("row", "label"),
            score: scalar("number", get("row", "score")),
          }),
        },
        {
          op: "sort",
          as: "row",
          by: [{ value: get("row", "score"), direction: "desc" }],
        },
      ],
    };
    expect(valueOf(expression, data)).toEqual([
      { label: "beta", score: 12 },
      { label: "gamma", score: 12 },
    ]);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("joins typed JSON collections and aggregates groups without task-specific logic", () => {
    const data = input({
      measurements: [
        { site: "x", amount: 2 },
        { site: "y", amount: 3 },
        { site: "x", amount: 5 },
      ],
      sites: [{ id: "x", label: "North" }],
    });
    const expression: IRExpr = {
      kind: "query",
      source: get("observations", "measurements"),
      steps: [
        {
          op: "join",
          right: get("observations", "sites"),
          leftAs: "reading",
          rightAs: "site",
          on: scalar("eq", get("reading", "site"), get("site", "id")),
          mode: "left",
        },
        {
          op: "project",
          as: "joined",
          value: object({
            label: scalar(
              "coalesce",
              get("joined", "right", "label"),
              literal("Unknown"),
            ),
            amount: get("joined", "left", "amount"),
          }),
        },
        {
          op: "group",
          as: "row",
          keys: { label: get("row", "label") },
          aggregates: {
            total: { op: "sum", value: get("row", "amount") },
            count: { op: "count" },
            mean: { op: "mean", value: get("row", "amount") },
            min: { op: "min", value: get("row", "amount") },
            max: { op: "max", value: get("row", "amount") },
            first: { op: "first", value: get("row", "amount") },
            last: { op: "last", value: get("row", "amount") },
            readings: { op: "collect", value: get("row", "amount") },
          },
        },
      ],
    };
    expect(valueOf(expression, data)).toEqual([
      {
        label: "North",
        total: 7,
        count: 2,
        mean: 3.5,
        min: 2,
        max: 5,
        first: 2,
        last: 5,
        readings: [2, 5],
      },
      {
        label: "Unknown",
        total: 3,
        count: 1,
        mean: 3,
        min: 3,
        max: 3,
        first: 3,
        last: 3,
        readings: [3],
      },
    ]);
  });

  it("flattens arrays, slices results and makes duplicate record behavior explicit", () => {
    const flattened: IRExpr = {
      kind: "query",
      source: literal([{ tags: ["x", "y"] }, { tags: ["z"] }]),
      steps: [
        { op: "flatMap", as: "row", value: get("row", "tags") },
        { op: "slice", offset: 1, limit: 1 },
      ],
    };
    expect(valueOf(flattened)).toEqual(["y"]);
    const rows = literal([
      { key: "one", value: 2 },
      { key: "one", value: 7 },
      { key: "two", value: 3 },
    ]);
    const record = (duplicates?: "first" | "last"): IRExpr => ({
      kind: "query",
      source: rows,
      steps: [
        {
          op: "record",
          as: "row",
          key: get("row", "key"),
          value: get("row", "value"),
          ...(duplicates ? { duplicates } : {}),
        },
      ],
    });
    expect(() => valueOf(record())).toThrow(/duplicate key/);
    expect(valueOf(record("first"))).toEqual({ one: 2, two: 3 });
    expect(valueOf(record("last"))).toEqual({ one: 7, two: 3 });
    expect(() =>
      valueOf({
        kind: "query",
        source: rows,
        steps: [
          {
            op: "record",
            as: "row",
            key: get("row", "key"),
            value: get("row", "value"),
          },
          { op: "slice", offset: 0, limit: 1 },
        ],
      }),
    ).toThrow(/final query step/);
  });

  it("deduplicates canonical object values with explicit first or last retention", () => {
    const rows = literal([
      { a: 1, b: 2 },
      { b: 2, a: 1 },
      { a: 2, b: 1 },
    ]);
    expect(
      valueOf({
        kind: "query",
        source: rows,
        steps: [{ op: "distinct", as: "row" }],
      }),
    ).toEqual([
      { a: 1, b: 2 },
      { a: 2, b: 1 },
    ]);
    expect(
      valueOf({
        kind: "query",
        source: rows,
        steps: [{ op: "distinct", as: "row", keep: "last" }],
      }),
    ).toEqual([
      { b: 2, a: 1 },
      { a: 2, b: 1 },
    ]);
  });

  it("keeps null placement independent of sort direction", () => {
    const source = literal([
      { id: "missing", n: null },
      { id: "small", n: 2 },
      { id: "large", n: 9 },
    ]);
    const sorted = (nulls: "first" | "last"): IRExpr => ({
      kind: "query",
      source,
      steps: [
        {
          op: "sort",
          as: "row",
          by: [{ value: get("row", "n"), direction: "desc", nulls }],
        },
      ],
    });
    expect(valueOf(sorted("last"))).toEqual([
      { id: "large", n: 9 },
      { id: "small", n: 2 },
      { id: "missing", n: null },
    ]);
    expect(valueOf(sorted("first"))).toEqual([
      { id: "missing", n: null },
      { id: "large", n: 9 },
      { id: "small", n: 2 },
    ]);
  });

  it.each([
    [scalar("number", literal(" 1.25e2 ")), 125],
    [scalar("string", literal(false)), "false"],
    [scalar("replace", literal("a.$a.$"), literal(".$"), literal("!")), "a!a!"],
    [scalar("trim", literal("  Value\n")), "Value"],
    [scalar("lower", literal("MiXeD")), "mixed"],
    [scalar("upper", literal("MiXeD")), "MIXED"],
    [scalar("split", literal("a::b"), literal("::")), ["a", "b"]],
    [scalar("join", literal(["a", "b"]), literal("/")), "a/b"],
    [scalar("sum", literal([])), 0],
    [scalar("min", literal([])), null],
    [scalar("max", literal([-3, -8])), -3],
    [scalar("slice", literal([1, 2, 3]), literal(1)), [2, 3]],
    [scalar("eq", literal({ a: 2, b: 3 }), literal({ b: 3, a: 2 })), true],
    [
      scalar("entries", literal({ first: 1, second: 2 })),
      [
        { key: "first", value: 1 },
        { key: "second", value: 2 },
      ],
    ],
  ])("evaluates a general scalar expression %#", (expression, expected) => {
    expect(valueOf(expression as IRExpr)).toEqual(expected);
  });

  it("evaluates conditional, boolean and coalescing arguments lazily", () => {
    const invalid = scalar("number", literal("not a number"));
    expect(
      valueOf(scalar("if", literal(true), literal("chosen"), invalid)),
    ).toBe("chosen");
    expect(valueOf(scalar("and", literal(false), invalid))).toBe(false);
    expect(valueOf(scalar("or", literal(true), invalid))).toBe(true);
    expect(
      valueOf(scalar("coalesce", literal(null), literal(8), invalid)),
    ).toBe(8);
    expect(() =>
      valueOf(scalar("if", literal(1), literal(2), literal(3))),
    ).toThrow(/boolean/);
  });

  it.each([
    scalar("number", literal("0x10")),
    scalar("number", literal("12kg")),
    scalar("number", literal("")),
    scalar("divide", literal(3), literal(0)),
    scalar("multiply", literal(1e308), literal(1e308)),
    scalar("add", literal("2"), literal(3)),
    scalar("sum", literal(["2", "3"])),
    scalar("round", literal(1), literal(2)),
  ])("rejects invalid or ambiguous arithmetic %#", (expression) => {
    expect(() => valueOf(expression)).toThrow(IRCompileError);
  });

  it("handles ISO timezones and date arithmetic without accepting rollover dates", () => {
    expect(valueOf(scalar("isoDate", literal("2024-02-29")))).toBe(
      "2024-02-29",
    );
    expect(
      valueOf(scalar("isoDate", literal("2024-02-29T23:00:00-02:00"))),
    ).toBe("2024-03-01");
    expect(
      valueOf(scalar("dateAddDays", literal("2024-02-28"), literal(2))),
    ).toBe("2024-03-01");
    for (const date of [
      "2024-02-30",
      "2023-02-29",
      "tomorrow",
      "2024-01-01T25:00:00Z",
      "2024-01-01T10:00:00",
    ])
      expect(() => valueOf(scalar("isoDate", literal(date)))).toThrow(
        /ISO|calendar|clock/,
      );
  });

  it("encodes CSV with ordered headers, quoted cells, scalar values and an empty-table boundary", () => {
    const schema = {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          note: { type: ["string", "null"] },
          enabled: { type: "boolean" },
          size: { type: "number" },
        },
        required: ["label", "note", "enabled", "size"],
        additionalProperties: false,
      },
    };
    const encoding = (rows: JsonValue[]): IRExpr => ({
      kind: "encode",
      format: "csv",
      value: literal(rows),
      columns: literal(["label", "note", "enabled", "size"]),
      schema,
    });
    expect(
      valueOf(
        encoding([
          { label: "a,b", note: 'a"b', enabled: true, size: 0 },
          { label: "name\nnext", note: null, enabled: false, size: 1.5 },
        ]),
      ),
    ).toBe(
      'label,note,enabled,size\n"a,b","a""b",true,0\n"name\nnext",,false,1.5',
    );
    expect(valueOf(encoding([]))).toBe("label,note,enabled,size");
  });

  it("validates encoded data schemas and rejects unsupported schema assertions", () => {
    const encoding = (
      schema: Record<string, unknown>,
      value: JsonValue,
    ): IRExpr => ({
      kind: "encode",
      format: "json",
      value: literal(value),
      schema,
    });
    expect(
      valueOf(
        encoding(
          {
            type: "object",
            properties: { size: { type: "number" } },
            required: ["size"],
            additionalProperties: false,
          },
          { size: 4 },
        ),
      ),
    ).toBe('{"size":4}');
    expect(() => valueOf(encoding({ type: "number" }, "4"))).toThrow(
      /declared data schema/,
    );
    expect(() =>
      valueOf(
        encoding({ type: "object", dependentRequired: { a: ["b"] } }, {}),
      ),
    ).toThrow(/unsupported assertion/);
    expect(() =>
      valueOf(encoding({ type: "string", pattern: "^(a+)+$" }, "a")),
    ).toThrow(/unsupported assertion/);
    expect(() =>
      valueOf({
        kind: "encode",
        format: "csv",
        value: literal([{}]),
        columns: literal(["missing"]),
        schema: { type: "array" },
      }),
    ).toThrow(/missing a selected column/);
    expect(() =>
      valueOf({
        kind: "encode",
        format: "csv",
        value: literal([]),
        columns: literal(["same", "same"]),
        schema: { type: "array" },
      }),
    ).toThrow(/CSV columns/);
  });

  it("makes text termination explicit without changing empty text", () => {
    const encoding = (value: JsonValue, terminalNewline: boolean): IRExpr => ({
      kind: "encode",
      format: "text",
      value: literal(value),
      terminalNewline,
      schema: {},
    });
    expect(valueOf(encoding(["a", "b"], false))).toBe("a\nb");
    expect(valueOf(encoding(["a", "b"], true))).toBe("a\nb\n");
    expect(valueOf(encoding("a\n", true))).toBe("a\n");
    expect(valueOf(encoding([], true))).toBe("");
    expect(valueOf(encoding("", true))).toBe("");
  });

  it("returns guarded typed operation proposals and next state without executing effects", () => {
    const plan: ForgeIR = {
      version: "forge-ir/v1",
      bindings: [],
      effects: [
        {
          operation: "controls.set",
          forEach: { source: get("observations", "items"), item: "item" },
          when: get("item", "enabled"),
          arguments: object({
            id: get("item", "id"),
            level: scalar("add", get("item", "level"), literal(1)),
          }),
        },
      ],
      result: { summary: literal("Prepared control changes") },
      state: object({ checkedAt: get("now") }),
    };
    const result = evaluateIR(
      plan,
      input({
        items: [
          { id: "one", enabled: true, level: 2 },
          { id: "two", enabled: false, level: 9 },
        ],
      }),
    );
    expect(result.operations).toEqual([
      { operation: "controls.set", arguments: { id: "one", level: 3 } },
    ]);
    expect(result.state).toEqual({ checkedAt: "2026-11-14T00:00:00.000Z" });
    expect(result.result.details).toEqual([]);
    const duplicates = evaluateIR(
      { ...plan, effects: [plan.effects[0], plan.effects[0]] },
      input({ items: [{ id: "one", enabled: true, level: 2 }] }),
    );
    expect(duplicates.operations).toEqual([
      result.operations[0],
      result.operations[0],
    ]);
  });

  it("rejects collection, work, effect and UTF-8 output overflows without truncation", () => {
    expect(() => valueOf(literal(Array(1001).fill(0)))).toThrow(/row budget/);
    const flattened: IRExpr = {
      kind: "query",
      source: get("observations", "groups"),
      steps: [{ op: "flatMap", as: "group", value: get("group", "values") }],
    };
    expect(() =>
      valueOf(
        flattened,
        input({
          groups: Array.from({ length: 51 }, () => ({
            values: Array(20).fill(1),
          })),
        }),
      ),
    ).toThrow(/row budget/);
    const joined: IRExpr = {
      kind: "query",
      source: get("observations", "left"),
      steps: [
        {
          op: "join",
          right: get("observations", "right"),
          leftAs: "first",
          rightAs: "second",
          on: literal(false),
          mode: "inner",
        },
      ],
    };
    expect(() =>
      valueOf(
        joined,
        input({ left: Array(200).fill(0), right: Array(200).fill(1) }),
      ),
    ).toThrow(/work budget/);
    const plan = program(literal(0));
    plan.effects = [
      {
        operation: "controls.set",
        forEach: { source: get("params", "targets"), item: "target" },
        arguments: object({ value: get("target") }),
      },
    ];
    expect(() =>
      evaluateIR(
        plan,
        input({}, { targets: Array.from({ length: 21 }, (_, index) => index) }),
      ),
    ).toThrow(/Effect count/);
    expect(() => valueOf(literal("😀".repeat(3000)))).toThrow(/byte budget/);
  });
});
