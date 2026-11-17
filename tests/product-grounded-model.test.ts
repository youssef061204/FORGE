import { describe, expect, it, vi } from "vitest";
import {
  GroundedMissionModel,
  planJsonSchema,
} from "../src/forge/product/grounded-model";
import { validateJson } from "../src/forge/product/schemas";
import type {
  GenerationRequest,
  StructuredTransport,
} from "../src/forge/product/model-transport";
import type { ConnectorDescriptor } from "../src/forge/product/contracts";
import type { MissionPlan } from "../src/forge/product/planning";
import type { PlanningContext } from "../src/forge/product/provider";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { ProductRuntime } from "../src/forge/product/runtime";
import { MemoryStateStore } from "../src/forge/store";

const resource: ConnectorDescriptor = {
  id: "archive",
  name: "Archive",
  kind: "builtin",
  mode: "test",
  status: "connected",
  binding: "fixture-archive-v1",
  setup: "",
  constraints: {},
  operations: [
    {
      id: "archive.list",
      connector: "archive",
      name: "Read records",
      description: "Read string records",
      kind: "read",
      permission: "archive.read",
      sideEffect: "none",
      idempotent: true,
      inputSchema: { type: "object", additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: { records: { type: "array", items: { type: "string" } } },
        required: ["records"],
        additionalProperties: false,
      },
    },
    {
      id: "archive.store",
      connector: "archive",
      name: "Store result",
      description: "Store a computed string",
      kind: "write",
      permission: "archive.write",
      sideEffect: "reversible",
      idempotent: true,
      inputSchema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
    },
  ],
};
const context: PlanningContext = {
  goal: "Copy the available string records into storage",
  resources: [resource],
  existing: [],
  conversation: [],
};
function plan(): MissionPlan {
  return {
    version: "mission-plan/v1",
    objective: context.goal,
    explanation: "Read records and store the JSON representation",
    route: "SYNTHESIZE",
    questions: [],
    existingIds: [],
    constraints: [],
    requirements: [
      {
        id: "read",
        description: "Read available records",
        access: "read",
        connector: "archive",
        operation: "archive.list",
        status: "available",
      },
      {
        id: "save",
        description: "Store the record data",
        access: "write",
        connector: "archive",
        operation: "archive.store",
        status: "available",
      },
    ],
    program: {
      name: "Copy records",
      description: "Read string records and store their JSON value",
      reads: [{ operation: "archive.list", arguments: {}, ref: "r0" }],
      actions: ["archive.store"],
      permissions: ["archive.read", "archive.write"],
      trigger: { kind: "manual" },
      representation: "ir",
      outputs: [],
      postconditions: [
        { kind: "effect", operation: "archive.store", count: 1 },
      ],
    },
  };
}
function ir(path = "records") {
  return {
    version: "forge-ir/v1",
    bindings: [],
    effects: [
      {
        operation: "archive.store",
        arguments: {
          kind: "object",
          fields: {
            value: {
              kind: "encode",
              format: "json",
              value: { kind: "get", root: "observations", path: ["r0", path] },
              schema: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    ],
    result: {
      summary: { kind: "literal", value: "Stored the selected records" },
    },
  };
}
function transport(responses: unknown[]) {
  const generate = vi.fn(async (request: GenerationRequest) => {
    void request;
    if (!responses.length) throw new Error("Recorded transport exhausted");
    return {
      text: JSON.stringify(responses.shift()),
      usage: {
        provider: "recorded-structured-test",
        model: null,
        region: null,
        calls: 0,
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        schemaValidated: false,
      },
    };
  });
  return {
    mode: "test" as const,
    status: async () => ({ ready: true, label: "Development mode · recorded" }),
    generate,
  } satisfies StructuredTransport;
}
describe("provider-independent grounded compilation", () => {
  it("constrains routes and resource availability from the registry rather than asking the model to guess facts", () => {
    const base = plan();
    const proposal = {
      ...base,
      program: Object.fromEntries(
        Object.entries(base.program!).filter(
          ([key]) => !["permissions", "postconditions"].includes(key),
        ),
      ),
    };
    const grammar = planJsonSchema(context);
    expect(() =>
      validateJson(grammar, proposal, "Generated plan"),
    ).not.toThrow();
    expect(() =>
      validateJson(
        grammar,
        { ...proposal, route: "EXTEND", existingIds: ["imaginary"] },
        "Unavailable route",
      ),
    ).toThrow();
    expect(() =>
      validateJson(
        grammar,
        { ...proposal, questions: ["Unnecessary confirmation?"] },
        "Unexpected question",
      ),
    ).toThrow();
    expect(() =>
      validateJson(
        grammar,
        {
          ...proposal,
          requirements: proposal.requirements.map((requirement, index) =>
            index ? requirement : { ...requirement, status: "missing" },
          ),
        },
        "Contradictory availability",
      ),
    ).toThrow();
  });
  it("derives necessary authority when the model omits redundant permission copying", async () => {
    const derived = plan();
    derived.program!.permissions = undefined;
    const calls = transport([derived, ir()]);
    const result = await new GroundedMissionModel(calls).plan(context);
    expect(result.solution.program?.actions).toEqual(["archive.store"]);
    expect(result.solution.program?.source).toContain("function execute");
  });
  it("materializes authorized observations as host-owned read-ref bindings", async () => {
    const generated = {
      version: "forge-ir/v1",
      bindings: [
        {
          id: "r0",
          value: {
            kind: "get",
            root: "input",
            path: ["reads", 0, "r0"],
          },
        },
      ],
      effects: [
        {
          operation: "archive.store",
          arguments: {
            kind: "object",
            fields: {
              value: {
                kind: "encode",
                format: "json",
                value: {
                  kind: "get",
                  root: "bindings",
                  path: ["r0", "records"],
                },
              },
            },
          },
        },
      ],
      result: {
        summary: { kind: "literal", value: "Stored the records" },
      },
    };
    const calls = transport([plan(), generated]);
    const result = await new GroundedMissionModel(calls).plan(context);
    expect(result.solution.program?.representation).toMatchObject({
      kind: "forge-ir/v1",
      ir: {
        bindings: [
          {
            id: "r0",
            value: {
              kind: "get",
              root: "observations",
              path: ["r0"],
            },
          },
        ],
      },
    });
    expect(result.solution.program?.representation?.ir).toMatchObject({
      effects: [
        {
          arguments: {
            fields: {
              value: {
                value: { root: "r0", path: ["records"] },
              },
            },
          },
        },
      ],
    });
  });
  it("grounds the plan before implementation and emits executable persistent software", async () => {
    let stored: unknown;
    let writes = 0;
    const fabric = new ConnectorFabric();
    fabric.register("archive", {
      describe: async () => resource,
      invoke: async (operation, args) =>
        operation === "archive.list"
          ? { data: { records: ["alpha", "beta"] }, target: "records" }
          : (writes++,
            (stored = args.value),
            {
              data: { id: "saved" },
              target: "record store",
              responseId: "saved",
            }),
      verify: async (_operation, args) => ({
        status: stored === args.value ? "verified" : "failed",
        reason: "Actual fixture state compared",
      }),
    });
    const modelTransport = transport([plan(), ir()]);
    const state = new MemoryStateStore();
    const runtime = new ProductRuntime(
      state,
      fabric,
      new GroundedMissionModel(modelTransport),
    );
    await runtime.initialize();
    const built = await runtime.ask(context.goal);
    expect(built.state).toBe("review");
    expect(modelTransport.generate).toHaveBeenCalledTimes(2);
    expect(built.tool?.representation?.kind).toBe("forge-ir/v1");
    expect(built.tool?.grants).toEqual([]);
    expect(writes).toBe(0);
    await runtime.approve(
      built.tool!.id,
      built.tool!.hash,
      built.tool!.permissions,
    );
    const run = await runtime.run(built.tool!.id, "unique-event");
    expect(run.status).toBe("done");
    expect(run.verification?.status).toBe("verified");
    expect(stored).toBe('["alpha","beta"]');
    expect((await runtime.run(built.tool!.id, "unique-event")).status).toBe(
      "ignored",
    );
    expect(writes).toBe(1);
    const restored = new ProductRuntime(
      state,
      fabric,
      new GroundedMissionModel(transport([])),
    );
    await restored.initialize();
    const reused = await restored.ask(context.goal);
    expect(reused.state).toBe("reuse");
    expect(reused.tool?.hash).toBe(built.tool?.hash);
  });
  it("returns a required connection without spending an implementation request", async () => {
    const missing = plan();
    missing.requirements[1] = {
      ...missing.requirements[1],
      connector: "other",
      operation: "other.store",
      status: "missing",
    };
    const calls = transport([missing]);
    const result = await new GroundedMissionModel(calls).plan(context);
    expect(result.solution.route).toBe("CONNECT");
    expect(result.solution.program).toBeUndefined();
    expect(calls.generate).toHaveBeenCalledTimes(1);
  });
  it("rejects excess authority before asking for implementation", async () => {
    const invalid = plan();
    invalid.program!.permissions!.push("unrelated.write");
    const calls = transport([invalid]);
    await expect(
      new GroundedMissionModel(calls).plan(context),
    ).rejects.toMatchObject({
      diagnostic: { code: "PERMISSION_MISMATCH", retryable: true },
    });
    expect(calls.generate).toHaveBeenCalledTimes(1);
  });
  it("feeds typed implementation failures into a bounded replacement attempt", async () => {
    const fabric = new ConnectorFabric();
    fabric.register("archive", {
      describe: async () => resource,
      invoke: async () => ({ data: { records: [] }, target: "fixture" }),
    });
    const calls = transport([plan(), ir("unknownField"), ir()]);
    const runtime = new ProductRuntime(
      new MemoryStateStore(),
      fabric,
      new GroundedMissionModel(calls),
    );
    await runtime.initialize();
    const result = await runtime.ask(context.goal);
    expect(result.state).toBe("review");
    expect(calls.generate).toHaveBeenCalledTimes(3);
    expect(calls.generate.mock.calls[2][0].context).toMatchObject({
      repair: expect.stringContaining("unknownField"),
    });
    expect(calls.generate.mock.calls[2][0].context).toMatchObject({
      repair: expect.stringContaining("Actual:"),
    });
    expect(
      runtime
        .progress(result.buildId)
        ?.attempts?.map((attempt) => attempt.status),
    ).toEqual(["failed", "succeeded"]);
  });
});
