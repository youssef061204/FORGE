import { describe, expect, it } from "vitest";
import { digest } from "../src/forge/hash";
import { MemoryStateStore } from "../src/forge/store";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { ProductRuntime, programHash } from "../src/forge/product/runtime";
import {
  RecordedMissionModel,
  type MissionModel,
} from "../src/forge/product/provider";
import { WorkspaceConnector } from "../src/forge/product/workspace";
import type {
  CallContext,
  ConnectorResult,
  ProgramDraft,
  VerificationContext,
  WorkspaceState,
} from "../src/forge/product/contracts";
import {
  TestTasksConnector,
  draft,
  harness,
  now,
  synthesis,
} from "./product-fixtures";

const payload = { name: "result.json", format: "json", text: '{"total":4}' };
function fileDraft(): ProgramDraft {
  return {
    name: "Local result",
    description: "Create a controlled downloadable result",
    source: `function execute(input: ModuleInput): ModuleOutput { return {operations:[{operation:"workspace.save",arguments:${JSON.stringify(payload)}}],result:{summary:"Output proposed"},state:{}}; }`,
    reads: [],
    actions: ["workspace.save"],
    trigger: { kind: "manual" },
    postconditions: [
      {
        kind: "effect",
        operation: "workspace.save",
        arguments: payload,
        count: 1,
      },
      {
        kind: "artifact",
        name: payload.name,
        format: "json",
        schema: {
          type: "object",
          properties: { total: { const: 4 } },
          required: ["total"],
          additionalProperties: false,
        },
      },
    ],
    tests: ["Synthetic input", "Empty input"].map((name) => ({
      name,
      input: { now, input: {}, observations: {}, state: {} },
      expectedOperations: ["workspace.save"],
      expectedEffects: [{ operation: "workspace.save", arguments: payload }],
    })),
  };
}
async function files(
  connectorFactory?: (store: MemoryStateStore) => WorkspaceConnector,
) {
  const store = new MemoryStateStore();
  const connector = connectorFactory?.(store) ?? new WorkspaceConnector(store);
  const fabric = new ConnectorFabric();
  fabric.register("workspace", connector);
  const runtime = new ProductRuntime(
    store,
    fabric,
    new RecordedMissionModel(() => synthesis(fileDraft())),
  );
  const tool = (await runtime.ask("Create the controlled local result")).tool!;
  await runtime.approve(tool.id, tool.hash, tool.permissions);
  return { store, connector, fabric, runtime, tool };
}
function withTaskReadback(): ProgramDraft {
  return {
    ...draft(),
    postconditions: [
      { kind: "effect", operation: "tasks.move", count: 1 },
      {
        kind: "readback",
        operation: "tasks.list",
        arguments: {},
        schema: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              contains: {
                type: "object",
                properties: {
                  id: { const: "task-a" },
                  due: { const: "2026-10-20" },
                },
                required: ["id", "due"],
              },
            },
          },
          required: ["tasks"],
        },
      },
    ],
  };
}

describe("committed outcome verification (local fixtures only)", () => {
  it("checks the saved artifact in persisted storage and never repeats a verified event", async () => {
    const h = await files();
    const run = await h.runtime.run(h.tool.id, "saved-file", {}, now);
    expect(run).toMatchObject({
      status: "done",
      verification: { status: "verified" },
    });
    expect(
      run.verification!.checks.every((check) => check.status === "verified"),
    ).toBe(true);
    const persisted = (await h.store.read()).product!;
    expect(persisted.workspace.artifacts).toHaveLength(1);
    expect(persisted.workspace.artifacts[0]).toMatchObject(payload);
    expect(
      persisted.executionPlans[Object.keys(persisted.executionPlans)[0]].run
        ?.verification?.status,
    ).toBe("verified");
    expect((await h.runtime.run(h.tool.id, "saved-file", {}, now)).status).toBe(
      "ignored",
    );
    expect((await h.store.read()).product!.workspace.artifacts).toHaveLength(1);
  });

  it("does not accept provisional workspace state or an acknowledgement as proof", async () => {
    const store = new MemoryStateStore();
    const connector = new WorkspaceConnector(store);
    const context: CallContext = {
      key: "not-persisted",
      mode: "live",
      now,
      observations: {},
      workspace: { binding: "test", documents: [], artifacts: [] },
    };
    const response = await connector.invoke("workspace.save", payload, context);
    const result = await connector.verify("workspace.save", payload, {
      ...context,
      receipt: {
        connector: "workspace",
        operation: "workspace.save",
        responseId: response.responseId,
        target: payload.name,
        at: now,
        status: "committed",
        mode: "test",
      },
    });
    expect(context.workspace!.artifacts).toHaveLength(1);
    expect(result.status).toBe("failed");
  });

  it("retains committed receipts after missing persisted output, and retries verification without resending writes", async () => {
    let original: WorkspaceState["artifacts"][number] | undefined;
    let invocations = 0;
    let removeOnce = true;
    const h = await files(
      (store) =>
        new (class extends WorkspaceConnector {
          override async invoke(
            id: string,
            args: Record<string, unknown>,
            context: CallContext,
          ) {
            invocations++;
            return super.invoke(id, args, context);
          }
          override async verify(
            id: string,
            args: Record<string, unknown>,
            context: VerificationContext,
          ) {
            if (removeOnce) {
              removeOnce = false;
              await store.transaction((state) => {
                original = structuredClone(
                  state.product!.workspace.artifacts[0],
                );
                state.product!.workspace.artifacts = [];
              });
            }
            return super.verify(id, args, context);
          }
        })(store),
    );
    const failed = await h.runtime.run(h.tool.id, "persisted-loss", {}, now);
    expect(failed).toMatchObject({
      status: "failed",
      verification: { status: "failed" },
    });
    expect(failed.receipts[0].status).toBe("committed");
    expect(
      Object.values((await h.store.read()).product!.outbox)[0].status,
    ).toBe("committed");
    await h.store.transaction((state) => {
      state.product!.workspace.artifacts.push(original!);
    });
    const retry = await h.runtime.run(h.tool.id, "persisted-loss", {}, now);
    expect(retry).toMatchObject({
      status: "done",
      verification: { status: "verified" },
    });
    expect(retry.receipts[0].status).toBe("deduplicated");
    expect(invocations).toBe(1);
  });

  it("keeps an opaque write unverified even when its independent readback predicate passes", async () => {
    const h = harness(() => synthesis(withTaskReadback()));
    const tool = (
      await h.runtime.ask("Keep the expected test deadline in committed state")
    ).tool!;
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    const run = await h.runtime.run(tool.id, "readback-success", {}, now);
    expect(run).toMatchObject({
      status: "done",
      verification: { status: "unverified" },
    });
    expect(h.tasks.writes).toHaveLength(1);
  });

  it("rejects false success when a connector acknowledges a write without changing the resulting state", async () => {
    const store = new MemoryStateStore();
    const fabric = new ConnectorFabric();
    class AcknowledgementOnly extends TestTasksConnector {
      override async invoke(
        id: string,
        args: Record<string, unknown>,
        context: CallContext,
      ): Promise<ConnectorResult> {
        if (id === "tasks.move")
          return { data: { id: "task-a" }, responseId: "test-ack" };
        return super.invoke(id, args, context);
      }
    }
    const tasks = new AcknowledgementOnly();
    fabric.register("tasks", tasks);
    const runtime = new ProductRuntime(
      store,
      fabric,
      new RecordedMissionModel(() => synthesis(withTaskReadback())),
    );
    const tool = (
      await runtime.ask("Update the task and check the resulting date")
    ).tool!;
    await runtime.approve(tool.id, tool.hash, tool.permissions);
    const run = await runtime.run(tool.id, "ack-without-effect", {}, now);
    expect(run).toMatchObject({
      status: "failed",
      verification: { status: "failed" },
    });
    expect(tasks.tasks[0].due).toBe("2026-10-19");
    expect(
      run.verification!.checks.find((check) =>
        check.name.startsWith("Readback"),
      )?.status,
    ).toBe("failed");
    expect(run.receipts[0].status).toBe("committed");
  });

  it("labels legacy execution and unverifiable declared effects as unverified", async () => {
    for (const program of [
      draft(),
      { ...draft(), postconditions: [] },
      {
        ...draft(),
        postconditions: [
          { kind: "effect" as const, operation: "tasks.move", count: 1 },
        ],
      },
    ]) {
      const h = harness(() => synthesis(program));
      const tool = (await h.runtime.ask("Execute the controlled task change"))
        .tool!;
      await h.runtime.approve(tool.id, tool.hash, tool.permissions);
      expect(await h.runtime.run(tool.id, "unverified", {}, now)).toMatchObject(
        { status: "done", verification: { status: "unverified" } },
      );
    }
  });

  it("rejects verification-only authority escalation before any connector effect", async () => {
    const h = harness(() =>
      synthesis({
        ...draft(),
        postconditions: [
          {
            kind: "readback",
            operation: "tasks.move",
            arguments: { id: "task-a", due: "2026-10-20" },
            schema: {},
          },
        ],
      }),
    );
    await expect(
      h.runtime.ask(
        "Check outcomes using an unauthorized verification operation",
      ),
    ).rejects.toThrow(/declared read/);
    expect(h.tasks.writes).toHaveLength(0);
    expect((await h.store.read()).product?.programs).toHaveLength(0);
  });

  it("keeps legacy hashes exact and makes postconditions and IR provenance tamper-evident", async () => {
    const h = harness();
    const tool = (
      await h.runtime.ask("Preserve this existing program identity")
    ).tool!;
    const {
      id,
      version,
      goal,
      source,
      reads,
      actions,
      trigger,
      permissions,
      bindings,
      tests,
    } = tool;
    expect(programHash(tool)).toBe(
      digest({
        id,
        version,
        goal,
        source,
        reads,
        actions,
        trigger,
        permissions,
        bindings,
        tests,
      }),
    );
    expect(
      programHash({
        ...tool,
        postconditions: [{ kind: "effect", operation: "tasks.move", count: 1 }],
      }),
    ).not.toBe(tool.hash);
    expect(
      programHash({
        ...tool,
        representation: {
          kind: "forge-ir/v1",
          compilerVersion: "test-1",
          ir: { expression: "test" },
        },
      }),
    ).not.toBe(tool.hash);
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    await h.store.transaction((state) => {
      state.product!.programs[0].postconditions = [
        { kind: "effect", operation: "tasks.move", count: 0 },
      ];
    });
    await expect(h.runtime.run(tool.id, "tampered", {}, now)).rejects.toThrow(
      /metadata changed/,
    );
    expect(h.tasks.writes).toHaveLength(0);
  });

  it("returns UNSUPPORTED without generating software or demanding an invented connection", async () => {
    const h = harness(() => ({
      route: "UNSUPPORTED",
      explanation:
        "The connected environment cannot provide this physical authority.",
      existingIds: [],
      missingConnections: [],
    }));
    expect(
      await h.runtime.ask("Perform an unsupported physical operation"),
    ).toMatchObject({ state: "unsupported", route: "UNSUPPORTED" });
    expect((await h.store.read()).product?.programs).toHaveLength(0);
  });

  it("allows explicitly capped three-attempt repair, records stages and preserves timing metadata", async () => {
    const h = harness();
    let attempts = 0;
    const model: MissionModel = {
      mode: "test",
      maximumAttempts: 3,
      status: async () => ({ ready: true, label: "Controlled local test" }),
      plan: async () => {
        attempts++;
        const program = draft();
        if (attempts === 1) program.actions = ["tasks.invented"];
        if (attempts === 2)
          program.source =
            'function execute(input: ModuleInput): ModuleOutput { const invalid: string = 1; return {operations:[],result:{summary:"Invalid"},state:{}}; }';
        return {
          solution: synthesis(program),
          usage: {
            provider: "recorded-test",
            model: null,
            region: null,
            calls: 0,
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
            schemaValidated: true,
            stageTimings: { planning: 2 },
          },
        };
      },
    };
    const runtime = new ProductRuntime(h.store, h.fabric, model);
    const result = await runtime.ask(
      "Repair this arbitrary controlled program",
      "three-attempts",
    );
    expect(result.state).toBe("review");
    expect(attempts).toBe(3);
    expect(result.tool!.usage.stageTimings).toEqual({ planning: 6 });
    expect(
      runtime
        .progress("three-attempts")!
        .attempts?.map((attempt) => attempt.structuredDiagnostic?.stage),
    ).toEqual(["grounding", "compilation", undefined]);
  });
  it("honors structured repairable model-plan diagnostics without falsifying schema validity", async () => {
    const h = harness();
    const failures: (string | undefined)[] = [];
    let attempts = 0;
    const model: MissionModel = {
      mode: "test",
      maximumAttempts: 2,
      status: async () => ({ ready: true, label: "Injected local plan" }),
      plan: async (context) => {
        attempts++;
        failures.push(context.failure);
        const usage = {
          provider: "recorded-test",
          model: null,
          region: null,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          calls: 0,
          schemaValidated: true,
        };
        if (attempts === 1)
          throw Object.assign(
            new Error("The grounded plan selected an unavailable operation"),
            {
              usage,
              diagnostic: {
                stage: "grounding",
                code: "OPERATION_UNAVAILABLE",
                message: "Use an operation in the connected catalog",
                path: "program.actions.0",
                retryable: true,
              },
            },
          );
        return { solution: synthesis(), usage };
      },
    };
    const runtime = new ProductRuntime(h.store, h.fabric, model);
    expect(
      (
        await runtime.ask(
          "Build a tool after bounded plan correction",
          "repair-plan",
        )
      ).state,
    ).toBe("review");
    expect(attempts).toBe(2);
    expect(failures[1]).toContain("OPERATION_UNAVAILABLE");
    expect(runtime.progress("repair-plan")?.attempts?.[0]).toMatchObject({
      usage: { schemaValidated: true },
      structuredDiagnostic: {
        stage: "grounding",
        code: "OPERATION_UNAVAILABLE",
        path: "program.actions.0",
        retryable: true,
      },
    });
  });

  it("does not retry a model error whose typed diagnostic forbids repair", async () => {
    const h = harness();
    let attempts = 0;
    const model: MissionModel = {
      mode: "test",
      maximumAttempts: 3,
      status: async () => ({ ready: true, label: "Injected local plan" }),
      plan: async () => {
        attempts++;
        throw Object.assign(new Error("Transport is unavailable"), {
          usage: {
            provider: "recorded-test",
            model: null,
            region: null,
            inputTokens: 0,
            outputTokens: 0,
            durationMs: 0,
            calls: 0,
            schemaValidated: false,
          },
          diagnostic: {
            stage: "provider",
            code: "TRANSPORT_UNAVAILABLE",
            message: "The local transport is unavailable",
            retryable: false,
          },
        });
      },
    };
    await expect(
      new ProductRuntime(h.store, h.fabric, model).ask(
        "Do not retry an unavailable transport",
      ),
    ).rejects.toThrow(/unavailable/);
    expect(attempts).toBe(1);
  });

  it("rejects asynchronous postcondition schemas before treating a Promise as proof", async () => {
    const h = harness(() =>
      synthesis({
        ...draft(),
        postconditions: [
          {
            kind: "readback",
            operation: "tasks.list",
            arguments: {},
            schema: { $async: true, type: "object" },
          },
        ],
      }),
    );
    await expect(
      h.runtime.ask("Verify using a bounded synchronous condition"),
    ).rejects.toThrow(/synchronous JSON Schema/);
    expect(h.tasks.writes).toHaveLength(0);
  });
  it("rejects a declared artifact schema mismatch before any output is committed", async () => {
    const store = new MemoryStateStore();
    const fabric = new ConnectorFabric();
    fabric.register("workspace", new WorkspaceConnector(store));
    const program = fileDraft();
    program.postconditions = [
      {
        kind: "artifact",
        name: payload.name,
        format: "json",
        schema: {
          type: "object",
          properties: { total: { const: 5 } },
          required: ["total"],
        },
      },
    ];
    const runtime = new ProductRuntime(
      store,
      fabric,
      new RecordedMissionModel(() => synthesis(program)),
    );
    await expect(
      runtime.ask("Save a result meeting the approved output schema"),
    ).rejects.toThrow(/postcondition.*schema/);
    expect((await store.read()).product!.workspace.artifacts).toHaveLength(0);
    expect((await store.read()).product!.programs).toHaveLength(0);
  });
});
