import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { ProductRuntime } from "../src/forge/product/runtime";
import {
  RecordedMissionModel,
  type PlanningContext,
} from "../src/forge/product/provider";
import { groundPlan, type MissionPlan } from "../src/forge/product/planning";
import type {
  CallContext,
  ConnectorDescriptor,
  FabricConnector,
  ProgramDraft,
  ProgramRun,
  VerificationContext,
} from "../src/forge/product/contracts";
import { MemoryStateStore } from "../src/forge/store";
import { digest } from "../src/forge/hash";

process.env.FORGE_FREE_ONLY = "true";
const out = resolve("artifacts/core-reliability-2026-11-16");
await mkdir(out, { recursive: true });
const corpusPath = "evaluation/core-mutations.json";
const corpusBytes = await readFile(corpusPath);
const corpus = JSON.parse(corpusBytes.toString("utf8")) as {
  version: string;
  variants: number[];
  families: {
    id: string;
    kind: "control" | "defect";
    expected: string;
    description: string;
  }[];
};
const now = "2026-11-16T15:00:00.000Z";
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const rowSchema = object({
  id: { type: "string" },
  value: { type: "number" },
  enabled: { type: "boolean" },
});
const entrySchema = object({
  id: { type: "string" },
  value: { type: "number" },
});
const descriptor: ConnectorDescriptor = {
  id: "records",
  name: "Controlled records",
  kind: "builtin",
  status: "connected",
  mode: "test",
  binding: "mutation-fixture-v1",
  setup: "",
  constraints: { localFixture: true },
  operations: [
    {
      id: "records.list",
      connector: "records",
      name: "Read records and stored entries",
      description: "Read synthetic local record state",
      kind: "read",
      permission: "records.read",
      sideEffect: "none",
      idempotent: true,
      inputSchema: object({}),
      outputSchema: object({
        rows: { type: "array", items: rowSchema, maxItems: 20 },
        entries: { type: "array", items: entrySchema, maxItems: 20 },
      }),
    },
    {
      id: "records.append",
      connector: "records",
      name: "Append a transformed entry",
      description: "Append to controlled local memory only",
      kind: "write",
      permission: "records.append.write",
      sideEffect: "reversible",
      idempotent: true,
      inputSchema: entrySchema,
      outputSchema: object({ id: { type: "string" } }),
    },
  ],
};
class Records implements FabricConnector {
  readonly rows: { id: string; value: number; enabled: boolean }[];
  readonly entries: { id: string; value: number }[] = [];
  readonly calls: { key: string; args: Record<string, unknown> }[] = [];
  private keys = new Set<string>();
  constructor(
    readonly variant: number,
    readonly opaque = false,
    readonly acknowledgeOnly = false,
  ) {
    this.rows = [
      { id: "active-" + variant, value: variant, enabled: true },
      { id: "disabled-" + variant, value: 5, enabled: false },
    ];
  }
  async describe() {
    return structuredClone(descriptor);
  }
  async invoke(
    operation: string,
    args: Record<string, unknown>,
    context: CallContext,
  ) {
    if (operation === "records.list")
      return {
        data: {
          rows: structuredClone(this.rows),
          entries: structuredClone(this.entries),
        },
        target: "controlled record state",
      };
    assert.equal(operation, "records.append");
    assert.equal(context.mode, "live", "Replay must never write");
    if (!this.keys.has(context.key)) {
      this.keys.add(context.key);
      this.calls.push({ key: context.key, args: structuredClone(args) });
      if (!this.acknowledgeOnly)
        this.entries.push({ id: String(args.id), value: Number(args.value) });
    }
    return {
      data: { id: String(args.id) },
      responseId: context.key,
      target: "controlled entry",
    };
  }
  async verify(
    _operation: string,
    args: Record<string, unknown>,
    context: VerificationContext,
  ) {
    if (this.opaque)
      return {
        status: "unverified" as const,
        reason:
          "Fixture deliberately has no committed-state verification support",
      };
    const expected = this.calls.find((call) => call.key === context.key);
    const actual = this.entries.find(
      (entry) => entry.id === args.id && entry.value === args.value,
    );
    return {
      status: expected && actual ? ("verified" as const) : ("failed" as const),
      reason: "Fresh fixture memory compared to the actual committed effect",
    };
  }
}

function source(variant: number, family: string) {
  const factor = [
    "self_consistent_wrong_computation",
    "no_postconditions",
  ].includes(family)
    ? 3
    : 2;
  const guarded = family !== "removed_idempotency_guard";
  const work =
    family === "partial_solution"
      ? ""
      : `
    for (const row of input.observations.records.rows) {
      if (row.enabled ${guarded ? "&& !seen.includes(row.id)" : ""}) {
        ${family === "runtime_exception" ? `if (row.value === ${variant}) throw new Error("Mutated input-dependent exception");` : ""}
        ${family === "timeout" ? `if (row.value === ${variant}) { while (true) {} }` : ""}
        const amount = ${family === "runtime_schema" ? `(row.value === ${variant} ? ("invalid" as unknown as number) : row.value * ${factor})` : `row.value * ${factor}`};
        operations.push({operation:${family === "unsafe_proposed_operation" ? `(row.value === ${variant} ? "records.destroy" : "records.append") as "records.append"` : '"records.append"'},arguments:{id:row.id,value:amount}});
        ${family === "duplicate_write" ? 'operations.push({operation:"records.append",arguments:{id:row.id,value:amount}});' : ""}
      }
    }`;
  let result = `function execute(input: ModuleInput): ModuleOutput {
    const seen = Array.isArray(input.state.seen) ? input.state.seen as string[] : [];
    const operations: ModuleOutput["operations"] = [];
    ${work}
    return {operations,result:{summary:"Controlled entry proposals"},state:{seen:seen.concat(operations.map(action=>action.arguments.id))}};
  }`;
  if (family === "syntax_error") result = result.slice(0, -1);
  if (family === "type_error")
    result = result.replace(
      "const operations:",
      'const broken: number = "not numeric"; const operations:',
    );
  if (family === "unsafe_access")
    result = result.replace(
      "const seen",
      "const blocked = process.env.FORGE_FAKE_SECRET; const seen",
    );
  if (family === "invented_operation")
    result = result.replaceAll("records.append", "records.erase");
  return result;
}
function draft(variant: number, family: string): ProgramDraft {
  const factor = [
    "self_consistent_wrong_computation",
    "no_postconditions",
  ].includes(family)
    ? 3
    : 2;
  const operation =
    family === "invented_operation" ? "records.erase" : "records.append";
  const copies =
    family === "duplicate_write" ? 2 : family === "partial_solution" ? 0 : 1;
  const guardFamily = [
    "removed_idempotency_guard",
    "valid_monitor_guard",
  ].includes(family);
  const postconditions: NonNullable<ProgramDraft["postconditions"]> = [
    ...(guardFamily
      ? []
      : [{ kind: "effect" as const, operation, count: copies || 1 }]),
    {
      kind: "readback",
      operation: "records.list",
      arguments: {},
      schema: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            minItems: 1,
            maxItems: 1,
            contains: object({
              id: { const: "active-" + variant },
              value: { const: variant * 2 },
            }),
          },
        },
        required: ["entries"],
      },
    },
  ];
  if (family === "vacuous_readback")
    postconditions[1] = {
      kind: "readback",
      operation: "records.list",
      arguments: {},
      schema: {},
    };
  return {
    name: "Transform enabled records",
    description:
      "Double each enabled record once and retain actual committed results",
    source: source(variant, family),
    reads: [{ operation: "records.list", arguments: {}, ref: "records" }],
    actions: [operation],
    trigger: { kind: "manual" },
    ...(family === "no_postconditions" ? {} : { postconditions }),
    tests: [true, false].map((enabled) => ({
      name: enabled ? "Positive synthetic record" : "Disabled record",
      input: {
        now,
        input: {},
        state: {},
        observations: {
          records: {
            rows: [{ id: "synthetic", value: 2, enabled }],
            entries: [],
          },
        },
      },
      expectedOperations: enabled
        ? Array.from({ length: copies }, () => operation)
        : [],
      expectedEffects: enabled
        ? Array.from({ length: copies }, () => ({
            operation,
            arguments: { id: "synthetic", value: 2 * factor },
          }))
        : [],
    })),
  };
}
function plan(): MissionPlan {
  return {
    version: "mission-plan/v1",
    route: "SYNTHESIZE",
    objective: "Transform enabled records",
    explanation: "Read the controlled records and append their doubled values",
    questions: [],
    existingIds: [],
    constraints: [],
    requirements: [
      {
        id: "read",
        description: "Read available records",
        access: "read",
        connector: "records",
        operation: "records.list",
        status: "available",
      },
      {
        id: "write",
        description: "Store transformed values",
        access: "write",
        connector: "records",
        operation: "records.append",
        status: "available",
      },
    ],
    program: {
      name: "Transform records",
      description: "Double enabled record values",
      reads: [{ operation: "records.list", arguments: {}, ref: "records" }],
      actions: ["records.append"],
      permissions: ["records.read", "records.append.write"],
      trigger: { kind: "manual" },
      representation: "ir",
      outputs: [],
      postconditions: [],
    },
  };
}
const planFamilies = new Set([
  "valid_plan",
  "missing_connection",
  "permission_missing",
  "permission_excess",
  "unnecessary_connector",
  "wrong_operation_direction",
  "omitted_plan_effect",
  "false_missing_connection",
]);
type Result = {
  id: string;
  family: string;
  kind: string;
  expected: string;
  variant: number;
  durationMs: number;
  actualDisposition: string;
  expectationMatched: boolean;
  independentGoalMatched: boolean | null;
  falseVerifiedSuccess: boolean;
  executionDoneButGoalWrong: boolean;
  writeInvocations: number;
  storedEntries: number;
  businessDuplicateEntries: number;
  sameEventDuplicateWrites: number;
  duplicateDeliveries: number;
  rejectedBeforeWrites: boolean;
  error?: string;
  run?: ProgramRun;
  followup?: ProgramRun;
  evidence: unknown;
  stageTimings: Record<string, number>;
};
const results: Result[] = [];
const sourcePaths = [
  "scripts/benchmark-core-mutations.ts",
  corpusPath,
  "src/forge/product/runtime.ts",
  "src/forge/product/planning.ts",
  "src/forge/product/verification.ts",
  "src/forge/product/contracts.ts",
  "src/forge/product/fabric.ts",
  "src/forge/executable.ts",
  "sandbox/module-worker.mjs",
];
const sourceFiles = await Promise.all(
  sourcePaths.map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
  })),
);
const start = performance.now();
async function persist(complete: boolean) {
  const defects = results.filter((result) => result.kind === "defect");
  const report = {
    version: "core-mutation-results/v1",
    at: new Date().toISOString(),
    complete,
    paidRequests: 0,
    providerCalls: 0,
    scope:
      "One generic hand-authored program/plan mutated into deterministic defect families. Real strict compiler, process sandbox, broker, grants, persistence and declared-state verification; synthetic in-memory connector only. Not fresh model generation, independent prompts, live Google, or universal semantic safety.",
    corpusSha256: createHash("sha256").update(corpusBytes).digest("hex"),
    sourceFiles,
    totals: {
      recorded: results.length,
      families: new Set(results.map((result) => result.family)).size,
      definedFamilies: corpus.families.length,
      controls: results.filter((result) => result.kind === "control").length,
      controlsPassed: results.filter(
        (result) => result.kind === "control" && result.expectationMatched,
      ).length,
      defectVariants: defects.length,
      requiredDefectOutcomesMatched: defects.filter(
        (result) => result.expectationMatched,
      ).length,
      rejectedOrFailedDefects: defects.filter((result) =>
        ["rejected", "failed"].includes(result.actualDisposition),
      ).length,
      explicitlyUnverifiedDefects: defects.filter(
        (result) => result.actualDisposition === "unverified",
      ).length,
      falseNegatives: defects.filter((result) => !result.expectationMatched)
        .length,
      falseVerifiedSuccesses: results.filter(
        (result) => result.falseVerifiedSuccess,
      ).length,
      executionDoneButIndependentGoalWrong: results.filter(
        (result) => result.executionDoneButGoalWrong,
      ).length,
      businessDuplicateEntriesFromDistinctEvents: results.reduce(
        (sum, result) => sum + result.businessDuplicateEntries,
        0,
      ),
      sameEventDuplicateWrites: results.reduce(
        (sum, result) => sum + result.sameEventDuplicateWrites,
        0,
      ),
      duplicateDeliveries: results.reduce(
        (sum, result) => sum + result.duplicateDeliveries,
        0,
      ),
      positiveVerifiedClaimRuns: results.filter(
        (result) =>
          (result.followup ?? result.run)?.status === "done" &&
          (result.followup ?? result.run)?.verification?.status === "verified",
      ).length,
      executionDoneRuns: results.filter(
        (result) => (result.followup ?? result.run)?.status === "done",
      ).length,
      p50Ms: percentile(
        results.map((result) => result.durationMs),
        0.5,
      ),
      p95Ms: percentile(
        results.map((result) => result.durationMs),
        0.95,
      ),
    },
    byFamily: corpus.families.map((family) => ({
      ...family,
      variants: results.filter((result) => result.family === family.id).length,
      matched: results.filter(
        (result) => result.family === family.id && result.expectationMatched,
      ).length,
      falseNegatives: results.filter(
        (result) => result.family === family.id && !result.expectationMatched,
      ).length,
    })),
    results,
    totalDurationMs: performance.now() - start,
    limitations: [
      "Repeated variants of each defect family are not independent population samples.",
      "A failed postcondition can detect a wrong effect after its fixture write committed; it does not undo that change.",
      "Business-state dedup across distinct events differs from duplicate-delivery dedup of the same event.",
      "Unverified is explicitly separate from rejected/failed and is not promoted as semantic defect detection.",
      "The corpus deliberately includes self-consistent wrong code/tests and weak contracts; failures remain visible.",
    ],
  };
  await writeFile(
    resolve(out, "mutations.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  return report;
}
function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
    : null;
}

for (const family of corpus.families)
  for (const variant of corpus.variants) {
    const started = performance.now();
    const result: Result = {
      id: family.id + "-" + variant,
      family: family.id,
      kind: family.kind,
      expected: family.expected,
      variant,
      durationMs: 0,
      actualDisposition: "rejected",
      expectationMatched: false,
      independentGoalMatched: null,
      falseVerifiedSuccess: false,
      executionDoneButGoalWrong: false,
      writeInvocations: 0,
      storedEntries: 0,
      businessDuplicateEntries: 0,
      sameEventDuplicateWrites: 0,
      duplicateDeliveries: 0,
      rejectedBeforeWrites: false,
      evidence: null,
      stageTimings: {},
    };
    const records = new Records(
      variant,
      family.id === "vacuous_readback",
      family.id === "vacuous_readback",
    );
    const fabric = new ConnectorFabric();
    fabric.register("records", records);
    const store = new MemoryStateStore();
    const proposed = draft(variant, family.id);
    const runtime = new ProductRuntime(
      store,
      fabric,
      new RecordedMissionModel(() => ({
        route: "SYNTHESIZE",
        explanation: "Recorded mutation fixture",
        existingIds: [],
        missingConnections: [],
        program: proposed,
      })),
    );
    try {
      if (planFamilies.has(family.id)) {
        const proposedPlan = plan();
        const resources = [structuredClone(descriptor)];
        if (family.id === "permission_missing")
          proposedPlan.program!.permissions!.pop();
        if (family.id === "permission_excess")
          proposedPlan.program!.permissions!.push("unrelated.write");
        if (family.id === "missing_connection") {
          proposedPlan.requirements[1].connector = "absent";
          proposedPlan.requirements[1].operation = "absent.append";
          proposedPlan.requirements[1].status = "missing";
        }
        if (family.id === "false_missing_connection")
          proposedPlan.requirements[1].status = "missing";
        if (family.id === "wrong_operation_direction") {
          proposedPlan.requirements[1].operation = "records.list";
          proposedPlan.requirements[1].access = "write";
        }
        if (family.id === "omitted_plan_effect")
          proposedPlan.program!.actions = [];
        if (family.id === "unnecessary_connector") {
          const extra = structuredClone(descriptor);
          extra.id = "extra";
          extra.name = "Unnecessary fixture";
          extra.operations = extra.operations.map((operation) => ({
            ...operation,
            id: operation.id.replace("records.", "extra."),
            connector: "extra",
            permission: operation.permission.replace("records.", "extra."),
          }));
          resources.push(extra);
          proposedPlan.program!.actions.push("extra.append");
          proposedPlan.program!.permissions!.push("extra.append.write");
        }
        const context: PlanningContext = {
          goal: "Double each enabled record once",
          resources,
          existing: [],
          conversation: [],
        };
        result.evidence = { proposedPlan, resources };
        const groundStarted = performance.now();
        const grounded = await groundPlan(proposedPlan, context);
        result.stageTimings.groundingMs = performance.now() - groundStarted;
        result.actualDisposition =
          grounded.plan.route === "CONNECT" ? "connect" : "grounded";
        result.evidence = {
          proposedPlan,
          resources,
          groundedRoute: grounded.plan.route,
          exactDerivedPermissions: grounded.metadata?.permissions,
          missingConnections: grounded.missingConnections,
        };
      } else {
        result.evidence = {
          source: proposed.source,
          sourceSha256: digest(proposed.source),
          proposedProgram: proposed,
          actualInputRows: records.rows,
        };
        const tool = (
          await runtime.ask(
            "Double enabled record values once and verify committed results",
          )
        ).tool!;
        const approval =
          family.id === "missing_approval_permission"
            ? tool.permissions.slice(0, 1)
            : tool.permissions;
        await runtime.approve(tool.id, tool.hash, approval);
        const run = await runtime.run(tool.id, "mutation-event", {}, now);
        result.run = run;
        result.stageTimings = {
          compileMs: tool.evidence.compileMs,
          sandboxMs: tool.evidence.sandboxMs,
          executionMs: run.durationMs,
          verificationMs: run.verification?.durationMs ?? 0,
        };
        if (
          ["valid_monitor_guard", "removed_idempotency_guard"].includes(
            family.id,
          ) &&
          run.status === "done"
        )
          result.followup = await runtime.run(
            tool.id,
            "second-distinct-event",
            {},
            now,
          );
        const finalRun = result.followup ?? run;
        result.actualDisposition =
          finalRun.status === "failed"
            ? "failed"
            : finalRun.verification?.status === "verified"
              ? "verified"
              : "unverified";
        result.independentGoalMatched =
          records.entries.length === 1 &&
          records.entries[0].id === "active-" + variant &&
          records.entries[0].value === variant * 2;
        result.falseVerifiedSuccess =
          finalRun.status === "done" &&
          finalRun.verification?.status === "verified" &&
          !result.independentGoalMatched;
        result.executionDoneButGoalWrong =
          finalRun.status === "done" && !result.independentGoalMatched;
        if (family.kind === "control" && run.status === "done") {
          const before = records.calls.length;
          const repeated = await runtime.run(
            tool.id,
            "mutation-event",
            {},
            now,
          );
          result.duplicateDeliveries++;
          result.sameEventDuplicateWrites += Math.max(
            0,
            records.calls.length - before,
          );
          assert.equal(repeated.status, "ignored");
          assert.equal(
            records.calls.length,
            before,
            "Same event must not repeat an effect",
          );
        }
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    result.durationMs = performance.now() - started;
    result.writeInvocations = records.calls.length;
    result.storedEntries = records.entries.length;
    result.businessDuplicateEntries = Math.max(
      0,
      records.entries.length -
        new Set(records.entries.map((entry) => entry.id)).size,
    );
    result.rejectedBeforeWrites =
      result.actualDisposition === "rejected" && records.calls.length === 0;
    result.expectationMatched =
      family.expected === "reject_or_fail"
        ? ["rejected", "failed"].includes(result.actualDisposition)
        : family.expected === "not_verified"
          ? result.actualDisposition !== "verified" &&
            !result.falseVerifiedSuccess
          : result.actualDisposition === family.expected &&
            (family.expected !== "verified" ||
              result.independentGoalMatched === true);
    if (family.kind === "control" && result.error)
      result.expectationMatched = false;
    results.push(result);
    await persist(false);
    console.log(
      JSON.stringify({
        id: result.id,
        actual: result.actualDisposition,
        expected: result.expected,
        matched: result.expectationMatched,
        writes: result.writeInvocations,
        falseVerifiedSuccess: result.falseVerifiedSuccess,
        durationMs: Math.round(result.durationMs),
        error: result.error,
      }),
    );
  }
const report = await persist(true);
console.log(
  JSON.stringify({
    report: resolve(out, "mutations.json"),
    totals: report.totals,
    paidRequests: 0,
  }),
);
if (results.some((result) => !result.expectationMatched)) process.exitCode = 1;
