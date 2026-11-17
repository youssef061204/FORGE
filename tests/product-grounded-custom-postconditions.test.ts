import { describe, expect, it, vi } from "vitest";
import { GroundedMissionModel } from "../src/forge/product/grounded-model";
import type { StructuredTransport } from "../src/forge/product/model-transport";
import type { MissionPlan } from "../src/forge/product/planning";
import type { PlanningContext } from "../src/forge/product/provider";
import { ProductRuntime } from "../src/forge/product/runtime";
import { WorkspaceConnector } from "../src/forge/product/workspace";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { MemoryStateStore } from "../src/forge/store";

const goal = "Save the first Unicode code point as codepoint.json";
const now = "2026-11-16T00:00:00.000Z";
const source = `function execute(input: ModuleInput): ModuleOutput {
  const text = input.input.text;
  const value = typeof text === "string" ? text.codePointAt(0) ?? null : null;
  return {operations:[{operation:"workspace.save",arguments:{name:"codepoint.json",format:"json",text:JSON.stringify({value})}}],result:{summary:"Proposed the Unicode result"},state:{}};
}`;
const implementation = {
  source,
  tests: [
    { text: "A", value: 65 },
    { text: "😀", value: 128512 },
  ].map(({ text, value }) => ({
    name: `Unicode ${text}`,
    input: { now, input: { text }, observations: {}, state: {} },
    expectedOperations: ["workspace.save"],
    expectedEffects: [
      {
        operation: "workspace.save",
        arguments: {
          name: "codepoint.json",
          format: "json",
          text: JSON.stringify({ value }),
        },
      },
    ],
  })),
};
function plan(): MissionPlan {
  return {
    version: "mission-plan/v1",
    route: "SYNTHESIZE",
    objective: goal,
    explanation: "Generate custom Unicode computation and persist its result",
    requirements: [
      {
        id: "save",
        description: "Persist the requested JSON artifact",
        access: "write",
        connector: "workspace",
        operation: "workspace.save",
        status: "available",
      },
    ],
    questions: [],
    existingIds: [],
    constraints: [],
    program: {
      name: "Unicode code point",
      description:
        "Compute a first Unicode code point in bounded custom TypeScript",
      reads: [],
      actions: ["workspace.save"],
      trigger: { kind: "manual" },
      representation: "typescript",
      customComputationReason:
        "Unicode code-point lookup is not an available IR scalar primitive",
      outputs: [{ name: "codepoint.json", format: "json", shape: "object" }],
      postconditions: [
        { kind: "effect", operation: "workspace.save", count: 1 },
      ],
    },
  };
}
function recorded(response: unknown) {
  const responses: unknown[] = [plan(), response];
  const generate = vi.fn(async () => ({
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
  }));
  const transport: StructuredTransport = {
    mode: "test",
    status: async () => ({ ready: true, label: "Recorded local regression" }),
    generate,
  };
  return { model: new GroundedMissionModel(transport), generate };
}
async function fixture(response: unknown = implementation) {
  const store = new MemoryStateStore();
  const workspace = new WorkspaceConnector(store);
  const fabric = new ConnectorFabric();
  fabric.register("workspace", workspace);
  const resources = [await workspace.describe()];
  const context: PlanningContext = {
    goal,
    resources,
    existing: [],
    conversation: [],
    now,
  };
  return { store, workspace, fabric, context, ...recorded(response) };
}

describe("custom TypeScript preserves the shared grounded output contract", () => {
  it("retains host-derived postconditions through compilation, approval, execution and artifact readback", async () => {
    const h = await fixture();
    const runtime = new ProductRuntime(h.store, h.fabric, h.model);
    await runtime.initialize();
    const built = await runtime.ask(goal);
    expect(built.state).toBe("review");
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(built.tool!.postconditions).toEqual([
      { kind: "effect", operation: "workspace.save", count: 1 },
      {
        kind: "artifact",
        name: "codepoint.json",
        format: "json",
        schema: { type: "object" },
      },
    ]);
    expect((await h.store.read()).product!.workspace.artifacts).toHaveLength(0);
    await runtime.approve(
      built.tool!.id,
      built.tool!.hash,
      built.tool!.permissions,
    );
    const run = await runtime.run(
      built.tool!.id,
      "unicode-event",
      { text: "😀" },
      now,
    );
    expect(run).toMatchObject({
      status: "done",
      verification: { status: "verified" },
    });
    const artifacts = (await h.store.read()).product!.workspace.artifacts;
    expect(artifacts).toHaveLength(1);
    expect(JSON.parse(artifacts[0].text)).toEqual({ value: 128512 });
    expect(h.generate).toHaveBeenCalledTimes(2);
  });

  it.each([
    { postconditions: [] },
    { actions: [] },
    { reads: [] },
    { trigger: { kind: "schedule", intervalSeconds: 60 } },
  ])(
    "rejects implementation fields that attempt to replace grounded authority or verification: %j",
    async (overrides) => {
      const h = await fixture({ ...implementation, ...overrides });
      await expect(h.model.plan(h.context)).rejects.toMatchObject({
        diagnostic: { code: "SCHEMA", retryable: true },
      });
      expect(h.generate).toHaveBeenCalledTimes(2);
      expect(
        (await h.store.read()).product?.workspace.artifacts ?? [],
      ).toHaveLength(0);
    },
  );
});
