import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { MemoryStateStore } from "../src/forge/store";
import { ConnectorFabric } from "../src/forge/product/fabric";
import { GroundedMissionModel } from "../src/forge/product/grounded-model";
import { LocalStructuredTransport } from "../src/forge/product/model-transport";
import { ProductRuntime, type GoalResult } from "../src/forge/product/runtime";
import { solutionSchema } from "../src/forge/product/contracts";
import type {
  MissionModel,
  ModelUsage,
  PlanningContext,
} from "../src/forge/product/provider";
import {
  importWorkspaceDocument,
  readWorkspaceArtifact,
  WorkspaceConnector,
} from "../src/forge/product/workspace";

// This benchmark is intentionally local-only. No fixture model, cloud connector,
// credentials, downloads, benchmark-level retries, generated expected answers or
// provider fallback. ProductRuntime permits up to two bounded corrections on the grounded local pipeline.
process.env.FORGE_FREE_ONLY = "true";

const inputSchema = z.object({
  name: z.string().min(1).max(80),
  format: z.enum(["csv", "text", "json"]),
  text: z.string().min(1).max(16384),
});
const expectedSchema = z.union([
  z.object({
    kind: z.literal("file"),
    name: z.string(),
    format: z.literal("csv"),
    rows: z.array(z.array(z.string())),
  }),
  z.object({
    kind: z.literal("file"),
    name: z.string(),
    format: z.literal("json"),
    value: z.unknown(),
  }),
  z.object({
    kind: z.literal("file"),
    name: z.string(),
    format: z.literal("text"),
    lines: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("connection"),
    serviceTerms: z.array(z.string()).min(1),
  }),
]);
const caseSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  category: z.string(),
  goal: z.string().min(5).max(4000),
  files: z.array(inputSchema),
  expectedRoute: z.enum(["SYNTHESIZE", "REUSE", "EXTEND", "CONNECT"]),
  expectedPermissions: z.array(z.string()),
  expected: expectedSchema,
  dependsOn: z.string().optional(),
  followUp: z.boolean().optional(),
  expectedModelRequests: z.number().int().nonnegative().optional(),
});
const corpusSchema = z.object({
  version: z.literal(1),
  frozenBeforeExecution: z.literal(true),
  description: z.string(),
  now: z.string().datetime(),
  cases: z.array(caseSchema).min(12).max(20),
});
type Mission = z.infer<typeof caseSchema>;
type Attempt = {
  number: number;
  provider: "ollama-local";
  model: string;
  startedAt: string;
  wallMs: number;
  status: "returned" | "failed";
  usage: ModelUsage | null;
  planningContext?: PlanningContext;
  route?: string;
  proposedSource?: string;
  proposedSolution?: unknown;
  modelFailure?: unknown;
  proposedPlan?: unknown;
  transportTrace?: unknown;
  error?: string;
};
type CaseResult = {
  id: string;
  category: string;
  goal: string;
  status: "passed" | "failed" | "blocked";
  expected: Mission["expected"];
  actual: unknown;
  expectedRoute: Mission["expectedRoute"];
  actualRoute: string | null;
  routeMatched: boolean;
  expectedPermissions: string[];
  actualPermissions: string[];
  permissionsMatched: boolean;
  semanticOutputMatched: boolean;
  modelRequests: number;
  attempts: Attempt[];
  durationMs: number;
  reviewMs: number | null;
  executionMs: number | null;
  firstSuccessfulExecutionMs: number | null;
  tool?: { id: string; version: string; hash: string; parentHash?: string };
  checksPassed: boolean | null;
  replayExternalWrites: number | null;
  receipts: unknown[];
  inputDocuments: { name: string; id: string; sha256: string }[];
  buildStages: unknown[];
  buildAttempts: NonNullable<
    NonNullable<ReturnType<ProductRuntime["progress"]>>["attempts"]
  >;
  admission: "first-pass" | "repaired" | "failed" | "not-applicable";
  error?: string;
};

const flags = new Map(
  process.argv.slice(2).map((flag) => {
    const index = flag.indexOf("=");
    return index < 0
      ? [flag, "true"]
      : [flag.slice(0, index), flag.slice(index + 1)];
  }),
);
for (const flag of flags.keys())
  if (!["--limit", "--model", "--validate-only"].includes(flag))
    throw new Error(`Unknown benchmark option: ${flag}`);
const corpusText = await readFile("evaluation/local-missions.json", "utf8");
const corpus = corpusSchema.parse(JSON.parse(corpusText));
const corpusHash = createHash("sha256").update(corpusText).digest("hex");
const sourceFiles = {
  benchmark: "scripts/benchmark-core-missions.ts",
  planning: "src/forge/product/planning.ts",
  transport: "src/forge/product/model-transport.ts",
  ir: "src/forge/product/ir.ts",
  irSchema: "src/forge/product/ir-schema.ts",
  irTypecheck: "src/forge/product/ir-typecheck.ts",
  irEmitter: "src/forge/product/ir-emit.ts",
  irEvaluator: "src/forge/product/ir-evaluate.ts",
  verification: "src/forge/product/verification.ts",
  provider: "src/forge/product/grounded-model.ts",
  runtime: "src/forge/product/runtime.ts",
  workspace: "src/forge/product/workspace.ts",
  contracts: "src/forge/product/contracts.ts",
  executable: "src/forge/executable.ts",
  corpus: "evaluation/local-missions.json",
};
const sourceSnapshots = await Promise.all(
  Object.entries(sourceFiles).map(async ([component, path]) => ({
    component,
    path,
    bytes: await readFile(path),
  })),
);
const sourceFingerprints = Object.fromEntries(
  sourceSnapshots.map(({ component, path, bytes }) => [
    component,
    { path, sha256: createHash("sha256").update(bytes).digest("hex") },
  ]),
);
const protocol = {
  entryPoints: [
    "ProductRuntime.ask",
    "ProductRuntime.approve",
    "ProductRuntime.run",
  ],
  provider: "GroundedMissionModel",
  modelWire:
    "Ollama loopback HTTP; /api/tags and /api/show cached-weight checks; POST /api/chat grounded mission plan then typed IR or custom source, both non-streaming",
  generationSchemaSha256: createHash("sha256")
    .update(JSON.stringify(z.toJSONSchema(solutionSchema)))
    .digest("hex"),
  workspace:
    "Typed per-document immutable reads and workspace.save(name, format, text), broker-derived exact permissions",
  executor:
    "Bounded TypeScript ModuleInput -> ModuleOutput structured proposals through process sandbox",
  evaluator:
    "Frozen exact route/permission labels and parsed CSV/JSON/text semantics; object-key order ignored, array/CSV row order preserved",
  maximumLocalPlanningAttempts: 3,
  repair:
    "At most two corrections after structured grounding/type/sandbox/postcondition failure; no evaluator-label repair or cloud fallback",
};
const fingerprints = {
  algorithm: "SHA-256",
  capturedBeforeInference: true,
  sourceFiles: sourceFingerprints,
  protocol,
  protocolSha256: createHash("sha256")
    .update(JSON.stringify(protocol))
    .digest("hex"),
};
const ids = new Set<string>();
for (const mission of corpus.cases) {
  if (ids.has(mission.id)) throw new Error("Duplicate frozen mission ID");
  if (mission.dependsOn && !ids.has(mission.dependsOn))
    throw new Error("Mission dependencies must precede their dependent case");
  if (mission.dependsOn && mission.files.length)
    throw new Error(
      "Dependent missions inherit their original immutable files",
    );
  ids.add(mission.id);
}
const limit = Number(flags.get("--limit") ?? corpus.cases.length);
if (!Number.isInteger(limit) || limit < 1 || limit > corpus.cases.length)
  throw new Error(`--limit must be between 1 and ${corpus.cases.length}`);

// The output evaluator is independent from the connector's CSV parser. It checks
// a complete table, including header and row order, against frozen expected cells.
function csvTable(text: string) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/(?:\r\n|\r|\n)$/, "");
  const token = /("(?:[^"]|"")*"|[^,"\r\n]*)(,|\r\n|\r|\n|$)/gy;
  const rows: string[][] = [];
  let row: string[] = [];
  let offset = 0;
  while (offset < normalized.length) {
    token.lastIndex = offset;
    const match = token.exec(normalized);
    if (!match || match[0].length === 0)
      throw new Error("Output contains invalid CSV");
    const value = match[1].startsWith('"')
      ? match[1].slice(1, -1).replace(/""/g, '"')
      : match[1];
    row.push(value);
    offset = token.lastIndex;
    if (match[2] !== ",") {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) {
    // A final separator creates one additional empty cell.
    if (normalized.endsWith(",")) row.push("");
    rows.push(row);
  }
  return rows;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ":" + canonical(item))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
function semanticContent(format: "csv" | "json" | "text", text: string) {
  if (format === "csv") return csvTable(text);
  if (format === "json") return JSON.parse(text) as unknown;
  return text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
}
function expectedContent(expectation: Mission["expected"]) {
  if (expectation.kind === "connection") return null;
  if (expectation.format === "csv") return expectation.rows;
  if (expectation.format === "json") return expectation.value;
  return expectation.lines;
}
if (flags.has("--validate-only")) {
  // No LocalMissionModel is instantiated and no HTTP request is made here.
  for (const mission of corpus.cases) {
    for (const file of mission.files) semanticContent(file.format, file.text);
    canonical(expectedContent(mission.expected));
  }
  console.log(
    JSON.stringify({
      validated: true,
      cases: corpus.cases.length,
      selected: limit,
      corpusHash,
      fingerprints,
      inferenceRequests: 0,
      paidRequests: 0,
    }),
  );
  process.exit(0);
}

class ObservedLocalModel implements MissionModel {
  readonly mode = "local" as const;
  readonly attempts: Attempt[] = [];
  constructor(
    readonly actual: MissionModel,
    readonly modelName: string,
  ) {}
  get maximumAttempts() {
    return this.actual.maximumAttempts;
  }
  finishBuild(buildId: string) {
    this.actual.finishBuild?.(buildId);
  }
  status() {
    return this.actual.status();
  }
  async plan(context: PlanningContext) {
    const started = performance.now();
    const attempt: Attempt = {
      number: this.attempts.length + 1,
      provider: "ollama-local",
      model: this.modelName,
      startedAt: new Date().toISOString(),
      wallMs: 0,
      status: "failed",
      usage: null,
      planningContext: structuredClone(context),
    };
    this.attempts.push(attempt);
    try {
      const returned = await this.actual.plan(context);
      attempt.status = "returned";
      attempt.usage = returned.usage;
      attempt.route = returned.solution.route;
      attempt.proposedSource = returned.solution.program?.source;
      attempt.proposedSolution = returned.solution;
      attempt.transportTrace = (
        returned as typeof returned & { trace?: unknown }
      ).trace;
      return returned;
    } catch (error) {
      attempt.error = String(error).slice(0, 3000);
      const metadata = error as {
        usage?: ModelUsage;
        proposedProgram?: { source?: unknown };
        proposedSolution?: { route?: unknown; program?: { source?: unknown } };
        modelFailure?: unknown;
        proposedPlan?: { route?: string };
        transportTrace?: unknown;
      } | null;
      attempt.usage = metadata?.usage ?? null;
      attempt.proposedSolution =
        metadata?.proposedSolution ?? metadata?.proposedProgram;
      attempt.modelFailure = metadata?.modelFailure;
      attempt.proposedPlan = metadata?.proposedPlan;
      attempt.transportTrace = metadata?.transportTrace;
      if (metadata?.proposedPlan?.route)
        attempt.route = metadata.proposedPlan.route;
      const source =
        metadata?.proposedProgram?.source ??
        metadata?.proposedSolution?.program?.source;
      if (typeof source === "string") attempt.proposedSource = source;
      if (typeof metadata?.proposedSolution?.route === "string")
        attempt.route = metadata.proposedSolution.route;
      throw error;
    } finally {
      attempt.wallMs = performance.now() - started;
    }
  }
}
type Session = {
  store: MemoryStateStore;
  runtime: ProductRuntime;
  model: ObservedLocalModel;
  documents: { name: string; id: string; sha256: string }[];
  originalToolId?: string;
  originalToolHash?: string;
};
const modelName = flags.get("--model") ?? "qwen2.5:7b-instruct";
const endpoint = "http://127.0.0.1:11435";
const runId =
  new Date().toISOString().replace(/[:.]/g, "-") +
  "-" +
  randomUUID().slice(0, 8);
const outputDirectory = resolve(
  "artifacts/core-reliability-2026-11-14/development-local",
);
await mkdir(resolve(outputDirectory, "runs"), { recursive: true });
// Freeze raw bytes and hash before the first status/inference request. Each run
// retains its original corpus, so later edits cannot silently change its labels.
await writeFile(
  resolve(outputDirectory, "runs", runId + ".corpus.json"),
  corpusText,
);
for (const { path, bytes } of sourceSnapshots) {
  const target = resolve(outputDirectory, "runs", runId + ".source", path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
const startedAt = new Date().toISOString();
const results: CaseResult[] = [];
const sessions = new Map<string, Session>();
const percentile = (values: number[], fraction: number) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[
    Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))
  ];
};
async function persist(complete: boolean) {
  const attempts = results.flatMap((result) => result.attempts);
  const report = {
    runId,
    startedAt,
    updatedAt: new Date().toISOString(),
    complete,
    provider: "ollama-local",
    model: modelName,
    endpoint,
    fingerprints,
    paidRequests: 0,
    sourceOrigin:
      "Actual cached GGUF inference through GroundedMissionModel and ProductRuntime; no recorded model responses or fixture planner",
    scope:
      "Frozen synthetic uploaded files, local persistent workspace outputs, exact declared permissions; no Google, remote service writes or native Alexa+ proof",
    corpus: {
      path: "evaluation/local-missions.json",
      frozenCopy:
        "artifacts/core-reliability-2026-11-14/development-local/runs/" +
        runId +
        ".corpus.json",
      sha256: corpusHash,
      total: corpus.cases.length,
      selected: limit,
    },
    policy: {
      maximumLocalPlanningAttemptsPerCase: 2,
      automaticRepair: true,
      repairScope:
        "bounded-local-only; one correction for runtime validation errors; no repair against frozen expected answers",
      benchmarkLevelRetries: 0,
      transportRetries: 0,
      fallback: false,
      storage:
        "fresh isolated MemoryStateStore per independent case; dependent cases share only their base session",
    },
    summary: {
      recorded: results.length,
      passed: results.filter((result) => result.status === "passed").length,
      failed: results.filter((result) => result.status === "failed").length,
      blocked: results.filter((result) => result.status === "blocked").length,
      modelRequests: attempts.length,
      planningAttempts: attempts.length,
      knownInferenceRequests: attempts.reduce(
        (sum, attempt) => sum + (attempt.usage?.calls ?? 0),
        0,
      ),
      attemptsWithUnknownInferenceCount: attempts.filter(
        (attempt) => !attempt.usage,
      ).length,
      failedModelRequests: attempts.filter(
        (attempt) => attempt.status === "failed",
      ).length,
      failedRuntimeAttempts: results
        .flatMap((result) => result.buildAttempts)
        .filter((attempt) => attempt.status === "failed").length,
      newSourceMissionsAttempted: results.filter(
        (result) =>
          ["SYNTHESIZE", "EXTEND"].includes(result.expectedRoute) &&
          result.modelRequests > 0,
      ).length,
      firstPassAdmissions: results.filter(
        (result) => result.admission === "first-pass",
      ).length,
      repairedAdmissions: results.filter(
        (result) => result.admission === "repaired",
      ).length,
      sourceMissionAdmissionFailures: results.filter(
        (result) => result.admission === "failed",
      ).length,
      repairAttemptedCases: results.filter(
        (result) => result.buildAttempts.length > 1,
      ).length,
      repairCasesPassingSemanticEvaluation: results.filter(
        (result) =>
          result.status === "passed" && result.buildAttempts.length > 1,
      ).length,
      admittedSourceCasesFailingSemanticEvaluation: results.filter(
        (result) =>
          ["first-pass", "repaired"].includes(result.admission) &&
          !result.semanticOutputMatched,
      ).length,
      failedCaseIds: results
        .filter((result) => result.status === "failed")
        .map((result) => result.id),
      blockedCaseIds: results
        .filter((result) => result.status === "blocked")
        .map((result) => result.id),
      modelReturnedSchemaValid: attempts.filter(
        (attempt) => attempt.usage?.schemaValidated,
      ).length,
      schemaValidationFailuresOrUnavailable: attempts.filter(
        (attempt) => !attempt.usage?.schemaValidated,
      ).length,
      inputTokensKnown: attempts.reduce(
        (sum, attempt) => sum + (attempt.usage?.inputTokens ?? 0),
        0,
      ),
      outputTokensKnown: attempts.reduce(
        (sum, attempt) => sum + (attempt.usage?.outputTokens ?? 0),
        0,
      ),
      attemptsWithUnavailableTokenUsage: attempts.filter(
        (attempt) => !attempt.usage || attempt.usage.tokensComplete === false,
      ).length,
      exactPermissionSets: results.filter((result) => result.permissionsMatched)
        .length,
      correctRoutes: results.filter((result) => result.routeMatched).length,
      semanticOutputsMatched: results.filter(
        (result) => result.semanticOutputMatched,
      ).length,
      allRecordedCasesP50Ms: percentile(
        results.map((result) => result.durationMs),
        0.5,
      ),
      allRecordedCasesP95Ms: percentile(
        results.map((result) => result.durationMs),
        0.95,
      ),
      successfulNewToolReviewP50Ms: percentile(
        results
          .filter(
            (result) =>
              result.status === "passed" &&
              ["SYNTHESIZE", "EXTEND"].includes(result.expectedRoute),
          )
          .flatMap((result) =>
            result.reviewMs === null ? [] : [result.reviewMs],
          ),
        0.5,
      ),
      successfulNewToolReviewP95Ms: percentile(
        results
          .filter(
            (result) =>
              result.status === "passed" &&
              ["SYNTHESIZE", "EXTEND"].includes(result.expectedRoute),
          )
          .flatMap((result) =>
            result.reviewMs === null ? [] : [result.reviewMs],
          ),
        0.95,
      ),
      recordedExecutionAttempts: results.filter(
        (result) => result.executionMs !== null,
      ).length,
      recordedExecutionP50Ms: percentile(
        results.flatMap((result) =>
          result.executionMs === null ? [] : [result.executionMs],
        ),
        0.5,
      ),
      recordedExecutionP95Ms: percentile(
        results.flatMap((result) =>
          result.executionMs === null ? [] : [result.executionMs],
        ),
        0.95,
      ),
      successfulFirstExecutionP50Ms: percentile(
        results
          .filter((result) => result.status === "passed")
          .flatMap((result) =>
            result.firstSuccessfulExecutionMs === null
              ? []
              : [result.firstSuccessfulExecutionMs],
          ),
        0.5,
      ),
      successfulFirstExecutionP95Ms: percentile(
        results
          .filter((result) => result.status === "passed")
          .flatMap((result) =>
            result.firstSuccessfulExecutionMs === null
              ? []
              : [result.firstSuccessfulExecutionMs],
          ),
        0.95,
      ),
      byCategory: Object.fromEntries(
        [...new Set(results.map((result) => result.category))].map(
          (category) => {
            const members = results.filter(
              (result) => result.category === category,
            );
            return [
              category,
              {
                recorded: members.length,
                passed: members.filter((result) => result.status === "passed")
                  .length,
                failed: members.filter((result) => result.status === "failed")
                  .length,
                blocked: members.filter((result) => result.status === "blocked")
                  .length,
              },
            ];
          },
        ),
      ),
    },
    results,
    limitations: [
      "Small transparent corpus, not a population estimate or 100 independently synthesized missions.",
      "A returned schema-valid solution is not a successful mission; output, route and exact authority are checked separately.",
      "Exact-goal reuse bypasses inference; its latency and zero planning calls must not be counted as new synthesis performance.",
      "Dependent extension/reuse cases are blocked if their base failed; those failures remain visible.",
      "Failed adapter calls may not expose token usage; null is retained rather than invented.",
      "First-pass/repaired admission measures source accepted by runtime checks, separately from independently evaluated semantic mission completion.",
      "Source/protocol fingerprints identify this software and frozen labels; no cached model weight hash or universal model determinism is claimed.",
      "The untrusted-source case checks executable handling of literal instruction-bearing input, not an independent LLM prompt-injection benchmark.",
    ],
  };
  const text = JSON.stringify(report, null, 2) + "\n";
  for (const target of [
    resolve(outputDirectory, "runs", runId + ".json"),
    resolve(outputDirectory, "benchmark.json"),
  ]) {
    const temporary = target + "." + randomUUID() + ".tmp";
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, target);
  }
}
await persist(false);
for (const mission of corpus.cases.slice(0, limit)) {
  const started = performance.now();
  const result: CaseResult = {
    id: mission.id,
    category: mission.category,
    goal: mission.goal,
    status: "failed",
    expected: mission.expected,
    actual: null,
    expectedRoute: mission.expectedRoute,
    actualRoute: null,
    routeMatched: false,
    expectedPermissions: [],
    actualPermissions: [],
    permissionsMatched: false,
    semanticOutputMatched: false,
    modelRequests: 0,
    attempts: [],
    durationMs: 0,
    reviewMs: null,
    executionMs: null,
    firstSuccessfulExecutionMs: null,
    checksPassed: null,
    replayExternalWrites: null,
    receipts: [],
    inputDocuments: [],
    buildStages: [],
    buildAttempts: [],
    admission: "not-applicable",
  };
  let session: Session | undefined;
  let attemptOffset = 0;
  let buildId: string | undefined;
  try {
    if (mission.dependsOn) {
      session = sessions.get(mission.dependsOn);
      if (session) attemptOffset = session.model.attempts.length;
      const base = results.find((item) => item.id === mission.dependsOn);
      if (!session?.originalToolId || base?.status !== "passed") {
        result.status = "blocked";
        throw new Error(
          "Base mission did not produce a verified installed tool; dependency not fabricated",
        );
      }
    } else {
      const store = new MemoryStateStore();
      const fabric = new ConnectorFabric();
      const model = new ObservedLocalModel(
        new GroundedMissionModel(
          new LocalStructuredTransport(modelName, endpoint),
        ),
        modelName,
      );
      const runtime = new ProductRuntime(store, fabric, model, "process", 0);
      session = { store, runtime, model, documents: [] };
      await runtime.initialize();
      for (const file of mission.files) {
        const metadata = await importWorkspaceDocument(store, file);
        session.documents.push({
          name: metadata.name,
          id: metadata.id,
          sha256: metadata.sha256,
        });
      }
      fabric.register("workspace", new WorkspaceConnector(store));
      sessions.set(mission.id, session);
    }
    result.inputDocuments = session.documents;
    result.expectedPermissions = mission.expectedPermissions
      .map((permission) => {
        if (permission === "write:outputs") return "workspace.outputs.write";
        if (!permission.startsWith("read:"))
          throw new Error("Unknown frozen permission label");
        const file = session!.documents.find(
          (document) => document.name === permission.slice(5),
        );
        if (!file)
          throw new Error(
            "Frozen expected read does not identify an uploaded input",
          );
        return "workspace." + file.id + ".read";
      })
      .sort();
    const previous = (
      await session.store.read()
    ).product!.workspace.artifacts.map((file) => file.id);
    attemptOffset = session.model.attempts.length;
    buildId = randomUUID();
    const goal: GoalResult = await session.runtime.ask(
      mission.goal,
      buildId,
      mission.followUp ? session.originalToolId : undefined,
    );
    result.reviewMs = performance.now() - started;
    result.actualRoute = goal.route ?? goal.state;
    result.routeMatched = goal.route === mission.expectedRoute;
    result.actualPermissions = [...(goal.tool?.permissions ?? [])].sort();
    result.permissionsMatched =
      canonical(result.expectedPermissions) ===
      canonical(result.actualPermissions);
    result.checksPassed = goal.tool?.evidence.passed ?? null;
    result.replayExternalWrites =
      goal.tool?.evidence.replay.externalWrites ?? null;
    if (goal.tool)
      result.tool = {
        id: goal.tool.id,
        version: goal.tool.version,
        hash: goal.tool.hash,
        parentHash: goal.tool.parentHash,
      };
    if (mission.expected.kind === "connection") {
      const answer = (
        goal.explanation +
        " " +
        (goal.missingConnections ?? []).join(" ")
      ).toLowerCase();
      const after = (await session.store.read()).product!.workspace.artifacts;
      result.actual = {
        state: goal.state,
        explanation: goal.explanation,
        missingConnections: goal.missingConnections ?? [],
        newLocalOutputs: after.filter((file) => !previous.includes(file.id))
          .length,
      };
      result.semanticOutputMatched =
        goal.state === "connect" &&
        !goal.tool &&
        mission.expected.serviceTerms.some((term) => answer.includes(term)) &&
        after.length === previous.length;
    } else {
      if (!goal.tool || !["review", "reuse"].includes(goal.state))
        throw new Error("Mission did not produce an executable tool");
      if (!result.routeMatched)
        throw new Error(
          "Solution route did not match the frozen expected decision",
        );
      if (!result.permissionsMatched)
        throw new Error(
          "Exact minimum permissions did not match; overbroad proposal was not approved",
        );
      if (
        mission.followUp &&
        (goal.tool.id !== session.originalToolId ||
          goal.tool.parentHash !== session.originalToolHash)
      )
        throw new Error(
          "Extension lost its original tool or parent source lineage",
        );
      if (goal.state === "review")
        await session.runtime.approve(
          goal.tool.id,
          goal.tool.hash,
          result.expectedPermissions,
        );
      const executionStarted = performance.now();
      const run = await session.runtime.run(
        goal.tool.id,
        runId + ":" + mission.id,
        {},
        corpus.now,
      );
      result.executionMs = performance.now() - executionStarted;
      result.receipts = run.receipts;
      const artifacts = (
        await session.store.read()
      ).product!.workspace.artifacts.filter(
        (file) => !previous.includes(file.id),
      );
      const actualFiles = await Promise.all(
        artifacts.map((file) => readWorkspaceArtifact(session!.store, file.id)),
      );
      result.actual = {
        runStatus: run.status,
        summary: run.summary,
        outputs: actualFiles.map((file) => ({
          name: file.name,
          format: file.format,
          text: file.text,
          semantic: semanticContent(file.format, file.text),
          sha256: file.sha256,
        })),
      };
      const output = actualFiles[0];
      result.semanticOutputMatched =
        run.status === "done" &&
        actualFiles.length === 1 &&
        output.name === mission.expected.name &&
        output.format === mission.expected.format &&
        canonical(semanticContent(output.format, output.text)) ===
          canonical(expectedContent(mission.expected));
      if (result.semanticOutputMatched)
        result.firstSuccessfulExecutionMs = performance.now() - started;
      if (!mission.dependsOn && result.semanticOutputMatched) {
        session.originalToolId = goal.tool.id;
        session.originalToolHash = goal.tool.hash;
      }
    }
    result.modelRequests = session.model.attempts.length - attemptOffset;
    result.status =
      result.routeMatched &&
      result.permissionsMatched &&
      result.semanticOutputMatched &&
      (mission.expectedModelRequests === undefined ||
        result.modelRequests === mission.expectedModelRequests)
        ? "passed"
        : "failed";
    if (result.status === "failed")
      result.error =
        "Frozen route, permission, semantic output or expected model-request count did not match; failure retained";
  } catch (error) {
    result.error = String(error).slice(0, 4000);
  } finally {
    if (session) {
      result.attempts = session.model.attempts.slice(attemptOffset);
      result.modelRequests = result.attempts.length;
      if (buildId) {
        const build = session.runtime.progress(buildId);
        result.buildStages = build?.stages ?? [];
        result.buildAttempts = build?.attempts ?? [];
      }
      if (
        ["SYNTHESIZE", "EXTEND"].includes(result.expectedRoute) &&
        result.modelRequests > 0
      ) {
        result.admission = result.checksPassed
          ? result.buildAttempts[0]?.status === "succeeded"
            ? "first-pass"
            : "repaired"
          : "failed";
      }
      if (!result.actualRoute)
        result.actualRoute = result.attempts.at(-1)?.route ?? null;
      result.routeMatched = result.actualRoute === mission.expectedRoute;
    }
    result.durationMs = performance.now() - started;
    results.push(result);
    await persist(false);
    console.log(
      JSON.stringify({
        id: result.id,
        status: result.status,
        route: result.actualRoute,
        modelRequests: result.modelRequests,
        durationMs: Math.round(result.durationMs),
        error: result.error,
      }),
    );
  }
}
await persist(true);
console.log(
  JSON.stringify({
    report:
      "artifacts/core-reliability-2026-11-14/development-local/benchmark.json",
    corpusHash,
    recorded: results.length,
    passed: results.filter((result) => result.status === "passed").length,
    paidRequests: 0,
  }),
);
if (results.some((result) => result.status !== "passed")) process.exitCode = 1;
