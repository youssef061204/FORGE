import { describe, expect, it } from "vitest";
import {
  groundPlan,
  resourceCatalog,
  type MissionPlan,
} from "../src/forge/product/planning";
import { productMode } from "../src/forge/product/runtime-mode";
import { configSchema } from "../src/forge/config";
import type { PlanningContext } from "../src/forge/product/provider";
import type { ConnectorDescriptor } from "../src/forge/product/contracts";

const resource: ConnectorDescriptor = {
  id: "archive",
  name: "Archive",
  kind: "builtin",
  status: "connected",
  mode: "test",
  binding: "archive-v1",
  setup: "",
  constraints: {},
  operations: [
    {
      id: "archive.list",
      connector: "archive",
      name: "List records",
      description: "Read records",
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
      description: "Save a result",
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
      outputSchema: { type: "object" },
    },
  ],
};
const context: PlanningContext = {
  goal: "Store the selected records",
  resources: [resource],
  existing: [],
  conversation: [],
};
function plan(): MissionPlan & {
  program: NonNullable<MissionPlan["program"]>;
} {
  return {
    version: "mission-plan/v1",
    route: "SYNTHESIZE",
    objective: context.goal,
    explanation: "Read and store records",
    requirements: [
      {
        id: "read",
        description: "Read the records",
        access: "read",
        connector: "archive",
        operation: "archive.list",
        status: "available",
      },
      {
        id: "save",
        description: "Store the result",
        access: "write",
        connector: "archive",
        operation: "archive.store",
        status: "available",
      },
    ],
    questions: [],
    existingIds: [],
    constraints: [],
    program: {
      name: "Record store",
      description: "Read records and save the requested result",
      reads: [{ operation: "archive.list", arguments: {}, ref: "r0" }],
      actions: ["archive.store"],
      permissions: ["archive.read", "archive.write"],
      trigger: { kind: "manual" },
      representation: "ir",
      outputs: [],
      postconditions: [],
    },
  };
}
describe("operation-grounded planning", () => {
  it("derives exact authority and graph edges from arbitrary connector contracts", async () => {
    const result = await groundPlan(plan(), context);
    expect(result.metadata?.permissions).toEqual([
      "archive.read",
      "archive.write",
    ]);
    expect(
      resourceCatalog(context.resources).edges.some(
        (edge) => edge.relation === "produces",
      ),
    ).toBe(true);
  });
  it("requests an unavailable essential connection before any code stage", async () => {
    const draft = plan();
    draft.requirements[1] = {
      ...draft.requirements[1],
      connector: "remote_archive",
      operation: "remote_archive.store",
    };
    const result = await groundPlan(draft, context);
    expect(result.plan.route).toBe("CONNECT");
    expect(result.plan.program).toBeUndefined();
    expect(result.missingConnections).toEqual(["remote_archive"]);
  });
  it("does not substitute an available output for a disconnected required action", async () => {
    const disconnected = structuredClone(resource);
    disconnected.status = "needs_consent";
    expect(
      (await groundPlan(plan(), { ...context, resources: [disconnected] })).plan
        .route,
    ).toBe("CONNECT");
  });
  it("rejects excessive authority and omitted effects", async () => {
    const excessive = plan();
    excessive.program.permissions!.push("other.write");
    await expect(groundPlan(excessive, context)).rejects.toThrow(
      "exact operation-derived",
    );
    const incomplete = plan();
    incomplete.program.actions = [];
    await expect(groundPlan(incomplete, context)).rejects.toThrow("omitted");
  });
  it("asks about unresolved choices and produces no program", async () => {
    const draft = plan();
    draft.questions = ["Which matching record should change?"];
    const result = await groundPlan(draft, context);
    expect(result.plan.route).toBe("CLARIFY");
    expect(result.plan.program).toBeUndefined();
  });
  it("represents an unsupported requirement without pretending it completed", async () => {
    const draft = plan();
    draft.requirements[1].status = "unsupported";
    expect((await groundPlan(draft, context)).plan.route).toBe("UNSUPPORTED");
  });
  it("rejects invented program lineage and an explicit edit targeting another tool", async () => {
    const draft = plan();
    draft.existingIds = ["absent"];
    await expect(groundPlan(draft, context)).rejects.toThrow("absent from");
    await expect(
      groundPlan(plan(), { ...context, editTargetId: "chosen" }),
    ).rejects.toThrow("explicit edit");
  });
});
describe("interactive provider modes", () => {
  it("blocks a paid PRODUCT provider in configuration before initialization", () => {
    expect(() =>
      configSchema.parse({ FORGE_PLANNER_PROVIDER: "bedrock" }),
    ).toThrow(/blocked/);
  });
  it("keeps PRODUCT separate from legacy fixture configuration", () => {
    expect(productMode({ FORGE_RUNTIME_MODE: "fixture" })).toEqual({
      mode: "product",
      provider: "local",
      recorded: false,
    });
    expect(productMode({ FORGE_RUNTIME_MODE: "aws" }).provider).toBe("bedrock");
  });
  it("requires explicit TEST mode for recordings and forbids packaged TEST mode", () => {
    expect(() =>
      productMode({ FORGE_PRODUCT_TEST_RESPONSES: "recorded.json" }),
    ).toThrow("explicit");
    expect(
      productMode({
        FORGE_APP_MODE: "test",
        FORGE_PRODUCT_TEST_RESPONSES: "recorded.json",
      }).recorded,
    ).toBe(true);
    expect(() =>
      productMode({ FORGE_APP_MODE: "test", NODE_ENV: "production" }),
    ).toThrow("disabled");
  });
});
