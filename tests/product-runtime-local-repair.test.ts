import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ProductRuntime } from "../src/forge/product/runtime";
import type {
  MissionModel,
  ModelUsage,
  PlanningContext,
} from "../src/forge/product/provider";
import type { Solution } from "../src/forge/product/contracts";
import { MemoryStateStore, type StateStore } from "../src/forge/store";
import { draft, harness, now, synthesis } from "./product-fixtures";

const usage = (index: number): ModelUsage => ({
  provider: "fake-local-model",
  model: "test-only",
  region: null,
  inputTokens: index * 15,
  outputTokens: index * 20,
  durationMs: index * 3.5,
  schemaValidated: true,
  calls: 1,
});
function setup(
  responses: Array<Solution | Error>,
  mode: MissionModel["mode"] = "local",
  store?: StateStore,
) {
  const h = harness(undefined, store);
  const contexts: PlanningContext[] = [];
  const model: MissionModel = {
    mode,
    status: async () => ({ ready: true, label: "Explicit test model" }),
    plan: vi.fn(async (context) => {
      contexts.push(context);
      const response = responses[contexts.length - 1];
      if (response instanceof Error) throw response;
      if (!response) throw new Error("Unexpected extra generation attempt");
      return { solution: response, usage: usage(contexts.length) };
    }),
  };
  const runtime = new ProductRuntime(h.store, h.fabric, model, "process", 2);
  return { ...h, runtime, model, contexts };
}
const wrongType = () =>
  synthesis({
    ...draft(),
    source:
      "function execute(input: ModuleInput): ModuleOutput { const wrong: string = 42; return {operations:[],result:{summary:wrong},state:{}}; }",
  });

describe("bounded local compiler repair", () => {
  it("asks the local model for corrected source once and aggregates both measured requests", async () => {
    const first = wrongType();
    const h = setup([first, synthesis()]);
    const result = await h.runtime.ask(
      "Align deadlines using the available task schema",
    );
    expect(h.contexts).toHaveLength(2);
    expect(h.contexts[0].failure).toBeUndefined();
    expect(h.contexts[1].failure).toContain(first.program!.source);
    expect(h.contexts[1].failure!.length).toBeLessThanOrEqual(14000);
    expect(result.tool!.source).toBe(draft().source);
    expect(result.usage).toMatchObject({
      calls: 2,
      inputTokens: 45,
      outputTokens: 60,
      durationMs: 10.5,
      schemaValidated: true,
    });
    expect(result.tool!.usage).toEqual(result.usage);
    expect(result.tool!.grants).toEqual([]);
    expect(
      result.tool!.evidence.checks.some(
        (check) => check.name === "Bounded local repair",
      ),
    ).toBe(true);
    expect(h.tasks.writes).toHaveLength(0);
    await expect(h.runtime.run(result.tool!.id)).rejects.toThrow(/unapproved/);
    const progress = h.runtime.progress(result.buildId)!;
    expect(progress.attempts?.map((attempt) => attempt.status)).toEqual([
      "failed",
      "succeeded",
    ]);
    expect(
      progress.stages.some((stage) =>
        stage.name.startsWith("Local attempt 1 failed"),
      ),
    ).toBe(true);
    await h.runtime.approve(
      result.tool!.id,
      result.tool!.hash,
      result.tool!.permissions,
    );
    expect(
      (await h.runtime.run(result.tool!.id, "approved", {}, now)).status,
    ).toBe("done");
    expect(h.tasks.writes).toHaveLength(1);
  });
  it("stops after the second failed local response with both failed attempts retained", async () => {
    const h = setup([wrongType(), wrongType(), synthesis()]);
    await expect(
      h.runtime.ask("Build this deadline tool without unlimited retries"),
    ).rejects.toThrow();
    expect(h.contexts).toHaveLength(2);
    expect((await h.store.read()).product!.programs).toHaveLength(0);
    expect(h.tasks.writes).toHaveLength(0);
    expect([...h.runtime.builds.values()][0]).toMatchObject({
      status: "failed",
      attempts: [{ status: "failed" }, { status: "failed" }],
    });
  });
  it.each(["test", "live"] as const)(
    "never automatically retries %s model responses",
    async (mode) => {
      const h = setup([wrongType(), synthesis()], mode);
      await expect(
        h.runtime.ask("Use only the explicitly allowed initial response"),
      ).rejects.toThrow();
      expect(h.contexts).toHaveLength(1);
      expect(h.tasks.writes).toHaveLength(0);
    },
  );
  it("repairs malformed model JSON using the reported failed-request usage", async () => {
    const error = Object.assign(
      new SyntaxError("Invalid JSON response from local compiler"),
      {
        usage: { ...usage(1), schemaValidated: false },
        proposedProgram: { source: "incomplete original program" },
      },
    );
    const h = setup([error, synthesis()]);
    const result = await h.runtime.ask(
      "Compile a task tool despite one malformed model response",
    );
    expect(result.usage).toMatchObject({
      calls: 2,
      inputTokens: 45,
      outputTokens: 60,
      durationMs: 10.5,
    });
    expect(h.contexts[1].failure).toContain("incomplete original program");
    expect(
      h.runtime.progress(result.buildId)!.attempts![0].usage?.schemaValidated,
    ).toBe(false);
    expect(h.tasks.writes).toHaveLength(0);
  });
  it("repairs provider schema errors once without fabricating unavailable token counts", async () => {
    let invalid: Error;
    try {
      z.object({ source: z.string() }).parse({ source: 1 });
    } catch (error) {
      invalid = error as Error;
    }
    const h = setup([invalid!, synthesis()]);
    const result = await h.runtime.ask(
      "Compile a tool after one schema-invalid proposal",
    );
    expect(h.contexts).toHaveLength(2);
    // The first provider did not report token/call usage. Preserve that absence;
    // progress records the attempted plan independently of provider telemetry.
    expect(result.usage!.calls).toBe(1);
    expect(
      h.runtime.progress(result.buildId)!.attempts![0].usage,
    ).toBeUndefined();
  });
  it.each([
    { ...synthesis(), route: "CLARIFY" as const, question: "Which deadline?" },
    {
      route: "CLARIFY" as const,
      explanation: "More detail needed",
      existingIds: [],
      missingConnections: [],
    },
    {
      route: "CONNECT" as const,
      explanation: "Connection needed",
      existingIds: [],
      missingConnections: [],
    },
    {
      ...synthesis(),
      route: "COMPOSE" as const,
      existingIds: ["missing-a", "missing-b"],
    },
  ])(
    "rejects inconsistent route contracts before bounded repair: $route",
    async (first) => {
      const h = setup([first, synthesis()]);
      const result = await h.runtime.ask(
        "Build a tool from the actually available operations",
      );
      expect(result.state).toBe("review");
      expect(h.contexts).toHaveLength(2);
      expect(h.tasks.writes).toHaveLength(0);
      expect((await h.store.read()).product!.programs).toHaveLength(1);
    },
  );
  it("reruns actual tests and replay after correcting a replay-rejected duplicate action", async () => {
    const broken = draft();
    broken.source = broken.source.replace(
      'operations.push({operation:"tasks.move",arguments:{id:task.id,due:"2026-10-20"}});',
      'operations.push({operation:"tasks.move",arguments:{id:task.id,due:"2026-10-20"}}); operations.push({operation:"tasks.move",arguments:{id:task.id,due:"2026-10-20"}});',
    );
    broken.tests[0].expectedOperations.push("tasks.move");
    const h = setup([synthesis(broken), synthesis()]);
    const result = await h.runtime.ask(
      "Deduplicate the task changes before approval",
    );
    expect(h.contexts[1].failure).toContain("identical write twice");
    expect(result.tool!.evidence.replay).toMatchObject({
      proposedOperations: 1,
      externalWrites: 0,
    });
    expect(h.tasks.writes).toHaveLength(0);
    expect(
      h.runtime
        .progress(result.buildId)!
        .stages.filter((stage) => stage.name === "Testing the tool"),
    ).toHaveLength(2);
  });
  it("does not retry external write failures or local model availability errors", async () => {
    const h = setup([synthesis(), synthesis()]);
    const tool = (await h.runtime.ask("Align this task after exact approval"))
      .tool!;
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    h.tasks.fail = new Error("External write timeout");
    expect((await h.runtime.run(tool.id, "timeout", {}, now)).status).toBe(
      "failed",
    );
    expect(h.contexts).toHaveLength(1);
    const unavailable = setup([
      new Error("Local server is unavailable"),
      synthesis(),
    ]);
    await expect(
      unavailable.runtime.ask("Compile while local service is unavailable"),
    ).rejects.toThrow(/unavailable/);
    expect(unavailable.contexts).toHaveLength(1);
  });
  it("does not generate another program after a persistence acknowledgement fails", async () => {
    const delegate = new MemoryStateStore();
    const store: StateStore = {
      read: () => delegate.read(),
      transaction: (callback) =>
        delegate.transaction(async (state) => {
          const before = state.product?.programs.length ?? 0;
          const result = await callback(state);
          if ((state.product?.programs.length ?? 0) > before)
            throw new Error("Storage acknowledgement failed");
          return result;
        }),
    };
    const h = setup([synthesis(), synthesis()], "local", store);
    await expect(
      h.runtime.ask("Build without retrying a storage acknowledgement"),
    ).rejects.toThrow(/acknowledgement/);
    expect(h.contexts).toHaveLength(1);
    expect(h.tasks.writes).toHaveLength(0);
  });
});
