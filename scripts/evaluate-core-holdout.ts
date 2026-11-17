/** Evaluation only. This file must never be imported by product routes/providers. */
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { resolve, relative, join, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { LocalStateStore } from "../src/forge/store";
import {
  ProductRuntime,
  programHash,
  type GoalResult,
} from "../src/forge/product/runtime";
import {
  RecordedMissionModel,
  type MissionModel,
  type ModelUsage,
} from "../src/forge/product/provider";
import { GroundedMissionModel } from "../src/forge/product/grounded-model";
import {
  LocalStructuredTransport,
  type StructuredTransport,
  type GenerationRequest,
} from "../src/forge/product/model-transport";
import {
  emptyProductState,
  programSchema,
  type Program,
  type ProgramRun,
} from "../src/forge/product/contracts";
import { retrievePrograms } from "../src/forge/product/retrieval";
import {
  FixtureWorld,
  copy,
  equal,
  sha256,
  evaluatePredicates,
  type HoldoutCase,
  type Oracle,
  type Recording,
  type PredicateResult,
} from "../evaluation/core-holdout-runner/fixtures";

const NativeDate = Date;
const ROOT = resolve(import.meta.dirname, "..");
const SEALED = resolve(ROOT, "evaluation/core-holdout-2026-11-12");
const EXPECTED_HOLDOUT_SEAL =
  "a11da48b82f9db9e171237325924815684eca36d606e63ffb57313d459f1dad9";
type Freeze = {
  frozenAt: string;
  holdoutSealSha256: string;
  sourceFiles: { path: string; sha256: string }[];
  notes?: string;
  sourceCommit?: string;
};
type Seal = {
  createdAt: string;
  total: number;
  contentSealSha256: string;
  categoryCounts: Record<string, number>;
  files: { path: string; sha256: string; bytes: number }[];
};
type Options = {
  freeze: string;
  provider: "recorded" | "local";
  limit?: number;
  out?: string;
};
type ProviderEvidence = {
  stage: string;
  request?: GenerationRequest;
  response?: string;
  usage?: ModelUsage;
  durationMs: number;
  error?: string;
};
type Row = {
  id: string;
  family: string;
  provider: string;
  status: "passed" | "failed" | "fixture-invalid";
  error?: string;
  failureStage?: string;
  route?: string;
  expectedRoute: string;
  routeAccurate: boolean;
  semanticRefusal: boolean;
  correctClarification: boolean;
  actualPermissions: string[];
  expectedPermissions: string[];
  permissionExact: boolean;
  postconditionSuccess: boolean;
  predicates: PredicateResult[];
  generationPolicyPassed: boolean;
  sideEffectPolicyPassed: boolean;
  executionSuccess: boolean;
  runtimeVerified: boolean;
  executionDoneWithFailedGoal: boolean;
  verifiedWithFailedGoal: boolean;
  fullWorkflowSuccess: boolean;
  executionFailedWithSatisfiedGoal: boolean;
  providerTruthfulnessPassed: boolean;
  providerAccounting: {
    planningAttempts: number;
    transportRequestsAttempted: number;
    knownInferenceRequests: number;
    attemptsWithUnknownUsage: number;
    inputTokensKnown: number;
    outputTokensKnown: number;
    attemptsWithIncompleteTokenUsage: number;
  };
  persisted: boolean;
  duplicateWrites: number;
  writes: number;
  forbiddenReplayWrites: number;
  timings: Record<string, number>;
  stages: unknown;
  attempts: unknown;
  compileEvidence?: unknown;
  result?: GoalResult;
  runs: ProgramRun[];
  modelEvidence: ProviderEvidence[];
  fixtureSetup?: unknown;
  stageMetrics: {
    firstPassBuild: boolean | null;
    buildAfterRepairOne: boolean | null;
    buildAfterRepairTwo: boolean | null;
    typedCompilationObserved: boolean;
    groundedDraftObserved: boolean;
    replayPassed: boolean;
  };
  retrieval: {
    candidates: number;
    ranked: { id: string; score: number }[];
    expectedIds: string[];
    recallAt1: number | null;
    recallAt3: number | null;
    reciprocalRank: number | null;
    includesDistractors: boolean;
  };
};
const errorText = (error: unknown) =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);
const jsonl = async <T>(file: string) =>
  (await readFile(file, "utf8"))
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
async function json(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value, null, 2) + "\n");
}
export function parseHoldoutOptions(argv: string[]): Options | undefined {
  if (argv.includes("--help")) return;
  const parsed: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--(freeze|provider|limit|out)=(.+)$/.exec(arg);
    if (!match || parsed[match[1]])
      throw new Error(
        "Use unique --freeze=path --provider=recorded|local [--limit=N] [--out=directory] options",
      );
    parsed[match[1]] = match[2];
  }
  if (!parsed.freeze)
    throw new Error(
      "--freeze=<source-freeze.json> is required before opening any sealed mission",
    );
  const provider = parsed.provider ?? "recorded";
  if (provider !== "recorded" && provider !== "local")
    throw new Error("Only recorded or genuinely local providers are permitted");
  const limit = parsed.limit === undefined ? undefined : Number(parsed.limit);
  if (
    limit !== undefined &&
    (!Number.isInteger(limit) || limit < 10 || limit > 100)
  )
    throw new Error(
      "A deterministic stratified local subset must contain 10..100 missions",
    );
  if (provider === "recorded" && limit !== undefined && limit !== 100)
    throw new Error(
      "The recorded offline integration run always includes all 100 missions",
    );
  return {
    freeze: resolve(ROOT, parsed.freeze),
    provider,
    limit,
    out: parsed.out,
  };
}
async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? walk(join(directory, entry.name))
          : Promise.resolve([join(directory, entry.name)]),
      ),
    )
  ).flat();
}
export async function verifyFreeze(
  file: string,
): Promise<{ freeze: Freeze; seal: Seal; freezeHash: string }> {
  // This gate deliberately precedes semantic reads of any sealed JSONL file.
  const freezeBytes = await readFile(file),
    freeze = JSON.parse(freezeBytes.toString("utf8")) as Freeze;
  const seal = JSON.parse(
    await readFile(join(SEALED, "manifest.json"), "utf8"),
  ) as Seal;
  if (seal.contentSealSha256 !== EXPECTED_HOLDOUT_SEAL)
    throw new Error("The manifest differs from the precommitted holdout seal");
  if (seal.total !== 100)
    throw new Error("The precommitted holdout must contain all 100 cases");
  if (
    !Number.isFinite(NativeDate.parse(freeze.frozenAt)) ||
    NativeDate.parse(freeze.frozenAt) < NativeDate.parse(seal.createdAt) ||
    NativeDate.parse(freeze.frozenAt) > NativeDate.now() + 300000
  )
    throw new Error(
      "Freeze timestamp must follow the seal and must not be in the future",
    );
  if (freeze.holdoutSealSha256 !== seal.contentSealSha256)
    throw new Error("Freeze references a different holdout seal");
  if (!Array.isArray(freeze.sourceFiles) || !freeze.sourceFiles.length)
    throw new Error("Freeze must bind actual architecture source bytes");
  const listed = new Set<string>();
  for (const entry of freeze.sourceFiles) {
    const path = resolve(ROOT, entry.path),
      rel = relative(ROOT, path).replaceAll("\\", "/");
    if (
      rel.startsWith("../") ||
      isAbsolute(rel) ||
      listed.has(rel) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error("Invalid or duplicate freeze source path/hash");
    listed.add(rel);
    if (sha256(await readFile(path)) !== entry.sha256)
      throw new Error("Architecture changed after freeze: " + rel);
  }
  const required = [
    ...(await walk(join(ROOT, "src/forge/product"))).filter((path) =>
      path.endsWith(".ts"),
    ),
    join(ROOT, "src/forge/executable.ts"),
  ];
  for (const file of required)
    if (!listed.has(relative(ROOT, file).replaceAll("\\", "/")))
      throw new Error(
        "Freeze omits architecture source: " + relative(ROOT, file),
      );
  for (const entry of seal.files) {
    const path = resolve(SEALED, entry.path);
    if (relative(SEALED, path).startsWith(".."))
      throw new Error("Seal path escapes its directory");
    const bytes = await readFile(path);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
      throw new Error("Immutable holdout seal mismatch: " + entry.path);
  }
  if (
    sha256(
      seal.files.map((entry) => entry.path + " " + entry.sha256).join("\n"),
    ) !== seal.contentSealSha256
  )
    throw new Error("Manifest content seal mismatch");
  return { freeze, seal, freezeHash: sha256(freezeBytes) };
}
export function selectHoldoutCases(cases: HoldoutCase[], limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > cases.length)
    throw new Error("Subset size must fit the available cases");
  const families = [...new Set(cases.map((row) => row.family))].sort();
  const groups = new Map(
    families.map((family) => [
      family,
      cases
        .filter((row) => row.family === family)
        .sort((a, b) =>
          sha256("forge-core-holdout-v1:" + a.id).localeCompare(
            sha256("forge-core-holdout-v1:" + b.id),
          ),
        ),
    ]),
  );
  const selected: HoldoutCase[] = [];
  for (let index = 0; selected.length < limit; index++)
    for (const family of families) {
      const row = groups.get(family)![index];
      if (row && selected.length < limit) selected.push(row);
    }
  return selected;
}
function controlledClock(initial: string) {
  const clock = { at: initial };
  globalThis.Date = new Proxy(NativeDate, {
    construct(target, values) {
      return Reflect.construct(target, values.length ? values : [clock.at]);
    },
    get(target, property, receiver) {
      return property === "now"
        ? () => NativeDate.parse(clock.at)
        : Reflect.get(target, property, receiver);
    },
  });
  return {
    set: (at: string) => {
      if (!Number.isFinite(NativeDate.parse(at)))
        throw new Error("Invalid fixture time");
      clock.at = at;
    },
    restore: () => {
      globalThis.Date = NativeDate;
    },
  };
}
function denyExternalNetwork(provider: Options["provider"]) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      provider !== "local" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["http:", "https:"].includes(url.protocol)
    )
      throw new Error("Holdout runner blocks external network access");
    return original(input, { ...init, redirect: "error" });
  };
  return () => {
    globalThis.fetch = original;
  };
}
function modelFor(
  provider: Options["provider"],
  recording: Recording | undefined,
  evidence: ProviderEvidence[],
): MissionModel {
  if (provider === "recorded") {
    if (!recording) throw new Error("Missing immutable authored recording");
    const model = new RecordedMissionModel(() => {
      evidence.push({
        stage: "authored-recorded-solution",
        response: JSON.stringify(recording.solution),
        durationMs: 0,
      });
      return copy(recording.solution);
    });
    // Replaying the same recording is not a repair. The frozen response is tried once.
    return Object.assign(model, { maximumAttempts: 1 });
  }
  const local = new LocalStructuredTransport();
  const transport: StructuredTransport = {
    mode: "local",
    status: () => local.status(),
    generate: async (request) => {
      const started = performance.now(),
        row: ProviderEvidence = {
          stage: request.stage,
          request: copy(request),
          durationMs: 0,
        };
      evidence.push(row);
      try {
        const response = await local.generate(request);
        row.response = response.text;
        row.usage = response.usage;
        return response;
      } catch (error) {
        row.error = errorText(error);
        row.usage = (error as { usage?: ModelUsage })?.usage;
        throw error;
      } finally {
        row.durationMs = performance.now() - started;
      }
    },
  };
  return new GroundedMissionModel(transport);
}
async function seedPrograms(
  runtime: ProductRuntime,
  mission: HoldoutCase,
): Promise<unknown[]> {
  const evidence: unknown[] = [];
  for (const seed of mission.installedPrograms) {
    const model = Object.assign(
      new RecordedMissionModel(() => ({
        route: "SYNTHESIZE",
        existingIds: [],
        missingConnections: [],
        explanation:
          "Validate an existing evaluator fixture through ordinary compilation and replay",
        program: copy(seed.draft),
      })),
      { maximumAttempts: 1 },
    );
    const installer = new ProductRuntime(
      runtime.store,
      runtime.fabric,
      model,
      "process",
      0,
    );
    const proposal = await installer.ask(
      seed.goal ?? seed.description,
      "seed-" + seed.id,
    );
    if (!proposal.tool || proposal.state !== "review")
      throw new Error("Installed fixture did not compile/replay: " + seed.id);
    const oldHash = proposal.tool.hash;
    const prepared = await runtime.store.transaction((state) => {
      const tool = state.product!.programs.find(
        (program) => program.hash === oldHash,
      )!;
      tool.id = seed.id;
      tool.version = seed.version;
      tool.goal = seed.goal ?? seed.description;
      tool.description = seed.description;
      tool.programState = copy(seed.programState ?? {});
      tool.hash = programHash(tool);
      return programSchema.parse(tool);
    });
    const approved = await installer.approve(
      prepared.id,
      prepared.hash,
      prepared.permissions,
    );
    const installed = await runtime.store.transaction((state) => {
      const current = state.product!.programs.find(
        (program) => program.hash === approved.hash,
      )!;
      const configured = programSchema.parse({
        ...current,
        ...(seed.status !== undefined ? { status: seed.status } : {}),
        ...(seed.grants !== undefined ? { grants: copy(seed.grants) } : {}),
        ...(seed.bindings !== undefined
          ? { bindings: copy(seed.bindings) }
          : {}),
      });
      configured.hash = programHash(configured);
      Object.assign(current, configured);
      return configured;
    });
    evidence.push({
      id: installed.id,
      hash: installed.hash,
      status: installed.status,
      grants: installed.grants,
      bindings: installed.bindings,
      evidence: installed.evidence,
    });
  }
  await runtime.store.transaction((state) => {
    const product = state.product!;
    product.conversation = mission.conversation.map((turn, index) => ({
      ...turn,
      id: "fixture-turn-" + index,
      at: mission.now,
    }));
    product.runs = [];
    product.executionPlans = {};
    product.outbox = {};
    product.triggerEvents = {};
    if (mission.lastToolId) product.lastToolId = mission.lastToolId;
    else delete product.lastToolId;
  });
  return evidence;
}
async function executeCase(
  mission: HoldoutCase,
  oracle: Oracle,
  recording: Recording | undefined,
  options: Options,
  directory: string,
): Promise<Row> {
  await mkdir(directory, { recursive: true });
  const clock = controlledClock(mission.now),
    started = performance.now(),
    modelEvidence: ProviderEvidence[] = [],
    runs: ProgramRun[] = [];
  let store = new LocalStateStore(join(directory, "state")),
    world = new FixtureWorld(mission, store),
    model: MissionModel;
  let runtime: ProductRuntime | undefined,
    result: GoalResult | undefined,
    tool: Program | undefined,
    baselinePrograms: Program[] = [],
    baselineCollections: Awaited<ReturnType<FixtureWorld["collections"]>> = {};
  let persisted = false,
    duplicateWrites = 0,
    setupComplete = false,
    setupEvidence: unknown,
    failure: unknown,
    phase = "fixture-setup",
    missionStarted: number | undefined;
  let ranked: { id: string; score: number }[] = [];
  const timings: Record<string, number> = {};
  const heartbeat = setInterval(
    () =>
      process.stdout.write(
        JSON.stringify({
          progress: mission.id,
          phase,
          elapsedMs: Math.round(performance.now() - started),
        }) + "\n",
      ),
    30000,
  );
  heartbeat.unref();
  try {
    model = modelFor(options.provider, recording, modelEvidence);
    runtime = new ProductRuntime(store, world.fabric(), model, "process", 0);
    await runtime.initialize();
    await world.seedWorkspace();
    setupEvidence = await seedPrograms(runtime, mission);
    baselinePrograms = copy((await store.read()).product!.programs);
    baselineCollections = await world.collections();
    setupComplete = true;
    timings.fixtureSetupMs = performance.now() - started;
    ranked = retrievePrograms(
      mission.request,
      baselinePrograms,
      baselinePrograms.length,
    ).map(({ program, score }) => ({ id: program.id, score }));
    missionStarted = performance.now();
    phase = "planning-and-build";
    const askStart = performance.now();
    try {
      result = await runtime.ask(mission.request, mission.id);
    } finally {
      timings.askMs = performance.now() - askStart;
      buildsByCase.set(mission.id, copy(runtime.progress(mission.id)));
    }
    tool = result.tool;
    if (result.state === "review")
      timings.timeToNewToolMs = performance.now() - missionStarted;
    if (result.state === "reuse")
      timings.timeToReusedToolMs = performance.now() - missionStarted;
    if (tool) {
      phase = "approval";
      const approveStart = performance.now();
      if (result.state === "review")
        tool = await runtime.approve(tool.id, tool.hash, tool.permissions);
      await store.transaction((state) => {
        const active = state.product!.programs.find(
          (p) => p.hash === tool!.hash,
        );
        if (!active) throw new Error("Approved tool disappeared");
        active.programState = copy(mission.initialProgramState);
      });
      timings.approvalMs = performance.now() - approveStart;
      phase = "execution";
      const executeStart = performance.now();
      runs.push(
        await runtime.run(
          tool.id,
          "initial:" + mission.id,
          mission.missionInput,
          mission.now,
        ),
      );
      timings.executionMs = performance.now() - executeStart;
      if (runs[0].status === "done")
        timings.timeToFirstCompletedExecutionMs =
          performance.now() - missionStarted;
      if (mission.repeatEvent) {
        const before = world.writes.length;
        const at = performance.now();
        runs.push(
          await runtime.run(
            tool.id,
            "initial:" + mission.id,
            mission.missionInput,
            mission.now,
          ),
        );
        duplicateWrites += world.writes.length - before;
        timings.duplicateReplayMs = performance.now() - at;
      }
      phase = "persistence-reload";
      const reloadStart = performance.now();
      const snapshot = join(directory, "fixture-state.json");
      await world.save(snapshot);
      store = new LocalStateStore(join(directory, "state"));
      world = await FixtureWorld.reload(mission, store, snapshot);
      runtime = new ProductRuntime(store, world.fabric(), model, "process", 0);
      await runtime.initialize();
      persisted = (await store.read()).product!.programs.some(
        (p) =>
          p.id === tool!.id && p.hash === tool!.hash && p.status === "ready",
      );
      timings.reloadMs = performance.now() - reloadStart;
      if (mission.repeatEvent) {
        const before = world.writes.length;
        runs.push(
          await runtime.run(
            tool.id,
            "initial:" + mission.id,
            mission.missionInput,
            mission.now,
          ),
        );
        duplicateWrites += world.writes.length - before;
      }
      phase = "scheduler";
      const tickStart = performance.now();
      for (const tick of mission.schedulerTicks) {
        world.replace(tick.replace);
        clock.set(tick.at);
        const beforeRuns = new Set(
          (await store.read()).product!.runs.map((run) => run.id),
        );
        await runtime.tick(tick.at);
        const product = (await store.read()).product!;
        const newRuns = product.runs.filter((run) => !beforeRuns.has(run.id));
        runs.push(...newRuns);
        if (!newRuns.length)
          throw new Error(
            "Scheduled fixture tick produced no actual runtime execution: " +
              tick.eventId,
          );
        const before = world.writes.length;
        await runtime.tick(tick.at);
        duplicateWrites += world.writes.length - before;
        for (const run of newRuns)
          if (mission.repeatEvent) {
            const beforeRepeat = world.writes.length;
            runs.push(await runtime.run(tool.id, run.eventId, {}, tick.at));
            duplicateWrites += world.writes.length - beforeRepeat;
          }
      }
      timings.schedulerMs = performance.now() - tickStart;
      await world.save(snapshot);
    } else {
      // Correct no-action dispositions are persisted too; reconstruct the actual store/runtime.
      await world.save(join(directory, "fixture-state.json"));
      store = new LocalStateStore(join(directory, "state"));
      world = await FixtureWorld.reload(
        mission,
        store,
        join(directory, "fixture-state.json"),
      );
      runtime = new ProductRuntime(store, world.fabric(), model, "process", 0);
      await runtime.initialize();
      persisted = true;
    }
  } catch (error) {
    failure = error;
  } finally {
    clearInterval(heartbeat);
    clock.restore();
  }
  const product = (await store.read()).product ?? emptyProductState();
  const finalCollections = await world.collections();
  const actualPermissions = [...(tool?.permissions ?? [])].sort(),
    expectedPermissions = [...oracle.permissions.values].sort();
  const predicates = setupComplete
    ? evaluatePredicates({
        mission,
        oracle,
        result,
        tool,
        baselinePrograms,
        finalProduct: product,
        baselineCollections,
        finalCollections,
        writes: world.writes,
        reloaded: persisted,
      })
    : [];
  const routeAccurate =
      !!result?.route && oracle.acceptableRoutes.includes(result.route),
    permissionExact = equal(actualPermissions, expectedPermissions);
  const postconditionSuccess =
    setupComplete &&
    predicates.length === oracle.postconditions.length &&
    predicates.every((p) => p.passed);
  const generationPolicyPassed =
    oracle.generation !== "forbidden" ||
    (product.programs.length === baselinePrograms.length &&
      product.programs.every((p) =>
        baselinePrograms.some((old) => old.hash === p.hash),
      ));
  const allowedActions = new Set(tool?.actions ?? []);
  const sideEffectPolicyPassed =
    world.writes.length <= oracle.sideEffectPolicy.maxWrites &&
    duplicateWrites <= oracle.sideEffectPolicy.duplicateWrites &&
    world.writes.filter((write) => !allowedActions.has(write.operation))
      .length <= oracle.sideEffectPolicy.undeclaredOperations &&
    world.replayWriteAttempts === 0;
  const executionRuns = runs.filter((run) => run.status !== "ignored"),
    executionSuccess =
      executionRuns.length > 0 &&
      executionRuns.every((run) => run.status === "done");
  const runtimeVerified =
    executionRuns.length > 0 &&
    executionRuns.every((run) => run.verification?.status === "verified");
  const reportedProviders = [
    result?.usage?.provider,
    tool?.usage.provider,
    ...modelEvidence.map((row) => row.usage?.provider),
  ].filter((provider): provider is string => Boolean(provider));
  const providerTruthfulnessPassed =
    oracle.mustNotClaimLive !== true ||
    (mission.resources.every(
      (resource) => resource.descriptor.mode === "test",
    ) &&
      executionRuns.every(
        (run) =>
          run.mode === "test" ||
          (run.mode === "simulation" && run.receipts.length === 0),
      ) &&
      reportedProviders.every(
        (provider) =>
          provider === "recorded-test" || provider === "ollama-local",
      ));
  const build = runtime?.progress(mission.id); // The original build is captured separately below before reload.
  const originalBuild = buildsByCase.get(mission.id) ?? build;
  timings.endToEndMs = performance.now() - started;
  if (missionStarted !== undefined)
    timings.missionEndToEndMs = performance.now() - missionStarted;
  if (tool && result?.state === "review") {
    timings.compileMs = tool.evidence.compileMs;
    timings.testsAndSandboxMs = tool.evidence.sandboxMs;
  }
  if (executionRuns.some((run) => run.verification))
    timings.verificationMs = executionRuns.reduce(
      (sum, run) => sum + (run.verification?.durationMs ?? 0),
      0,
    );
  for (const attempt of originalBuild?.attempts ?? [])
    for (const [stage, duration] of Object.entries(
      attempt.usage?.stageTimings ?? {},
    ))
      timings["provider_" + stage + "Ms"] =
        (timings["provider_" + stage + "Ms"] ?? 0) + duration;
  const structured = originalBuild?.attempts?.find(
    (attempt) => attempt.status === "failed",
  )?.structuredDiagnostic;
  const attempts = originalBuild?.attempts ?? [];
  const providerAccounting = {
    planningAttempts: attempts.length,
    transportRequestsAttempted: modelEvidence.filter((row) => row.request)
      .length,
    knownInferenceRequests: attempts.reduce(
      (sum, attempt) => sum + (attempt.usage?.calls ?? 0),
      0,
    ),
    attemptsWithUnknownUsage: attempts.filter((attempt) => !attempt.usage)
      .length,
    inputTokensKnown: attempts.reduce(
      (sum, attempt) => sum + (attempt.usage?.inputTokens ?? 0),
      0,
    ),
    outputTokensKnown: attempts.reduce(
      (sum, attempt) => sum + (attempt.usage?.outputTokens ?? 0),
      0,
    ),
    attemptsWithIncompleteTokenUsage: attempts.filter(
      (attempt) => attempt.usage?.tokensComplete === false,
    ).length,
  };
  const neededIds = (oracle.postconditions.find(
    (p) => p.kind === "existingProgramsUsed",
  )?.ids ?? []) as string[];
  const firstRelevant = ranked.findIndex((row) => neededIds.includes(row.id));
  const retrieval = {
    candidates: baselinePrograms.length,
    ranked,
    expectedIds: neededIds,
    recallAt1: neededIds.length
      ? neededIds.filter((id) =>
          ranked.slice(0, 1).some((row) => row.id === id),
        ).length / neededIds.length
      : null,
    recallAt3: neededIds.length
      ? neededIds.filter((id) =>
          ranked.slice(0, 3).some((row) => row.id === id),
        ).length / neededIds.length
      : null,
    reciprocalRank: neededIds.length
      ? firstRelevant < 0
        ? 0
        : 1 / (firstRelevant + 1)
      : null,
    includesDistractors:
      neededIds.length > 0 &&
      baselinePrograms.some((program) => !neededIds.includes(program.id)),
  };
  const softwareBuildAttempted =
    originalBuild?.stages.some((stage) =>
      [
        "Building the tool",
        "Building the updated tool",
        "Grounding connected operations",
        "Compiling the tool",
      ].includes(stage.name),
    ) ?? false;
  const stageMetrics = {
    firstPassBuild:
      softwareBuildAttempted && attempts.length
        ? attempts[0].status === "succeeded"
        : null,
    buildAfterRepairOne:
      softwareBuildAttempted && attempts.length > 1
        ? attempts[1].status === "succeeded"
        : null,
    buildAfterRepairTwo:
      softwareBuildAttempted && attempts.length > 2
        ? attempts[2].status === "succeeded"
        : null,
    typedCompilationObserved:
      originalBuild?.stages.some(
        (stage) => stage.name === "Testing the tool",
      ) ?? false,
    groundedDraftObserved:
      originalBuild?.stages.some(
        (stage) => stage.name === "Compiling the tool",
      ) ?? false,
    replayPassed: !!tool?.evidence.checks.some(
      (check) => check.name === "Read-only reality replay" && check.passed,
    ),
  };
  const semanticRefusal = predicates.some(
    (p) =>
      ["connectionRequest", "unsupportedExplanation"].includes(p.kind) &&
      p.passed,
  );
  const success =
    setupComplete &&
    !failure &&
    routeAccurate &&
    permissionExact &&
    postconditionSuccess &&
    generationPolicyPassed &&
    sideEffectPolicyPassed;
  const row: Row = {
    id: mission.id,
    family: mission.family,
    provider: options.provider,
    status: !setupComplete ? "fixture-invalid" : success ? "passed" : "failed",
    ...(failure
      ? {
          error: errorText(failure),
          failureStage: !setupComplete
            ? "fixture-setup"
            : (structured?.stage ?? phase),
        }
      : !routeAccurate
        ? { failureStage: "routing" }
        : !permissionExact
          ? { failureStage: "permission-exact-match" }
          : !postconditionSuccess
            ? { failureStage: "independent-postcondition" }
            : !generationPolicyPassed || !sideEffectPolicyPassed
              ? { failureStage: "policy-containment" }
              : {}),
    route: result?.route,
    expectedRoute: oracle.route,
    routeAccurate,
    semanticRefusal,
    correctClarification: predicates.some(
      (p) => p.kind === "clarificationQuestion" && p.passed,
    ),
    actualPermissions,
    expectedPermissions,
    permissionExact,
    postconditionSuccess,
    predicates,
    generationPolicyPassed,
    sideEffectPolicyPassed,
    executionSuccess,
    runtimeVerified,
    executionDoneWithFailedGoal:
      executionRuns.some((run) => run.status === "done") &&
      !postconditionSuccess,
    verifiedWithFailedGoal:
      executionRuns.some((run) => run.verification?.status === "verified") &&
      !postconditionSuccess,
    fullWorkflowSuccess:
      success && (!tool || executionSuccess) && providerTruthfulnessPassed,
    executionFailedWithSatisfiedGoal:
      executionRuns.some((run) => run.status === "failed") &&
      postconditionSuccess,
    providerAccounting,
    providerTruthfulnessPassed,
    persisted,
    duplicateWrites,
    writes: world.writes.length,
    forbiddenReplayWrites: world.replayWriteAttempts,
    timings,
    stages: originalBuild?.stages ?? [],
    attempts: originalBuild?.attempts ?? [],
    compileEvidence: tool?.evidence,
    result,
    runs,
    modelEvidence,
    fixtureSetup: setupEvidence,
    stageMetrics,
    retrieval,
  };
  await json(join(directory, "result.json"), row);
  await json(join(directory, "captured-evidence.json"), {
    mission,
    oracle,
    baselinePrograms,
    product,
    baselineCollections,
    finalCollections,
    committedFixtureWrites: world.writes,
  });
  return row;
}

// Keep build evidence across ProductRuntime reconstruction without modifying it.
const buildsByCase = new Map<string, ReturnType<ProductRuntime["progress"]>>();
function percent(rows: Row[], test: (row: Row) => boolean) {
  return {
    passed: rows.filter(test).length,
    total: rows.length,
    rate: rows.length ? rows.filter(test).length / rows.length : null,
  };
}
function quantile(values: number[], q: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)]
    : null;
}
export function summarizeHoldoutRows(rows: Row[]) {
  const executable = rows.filter((row) =>
    row.runs.some((run) => run.status !== "ignored"),
  );
  const compiled = rows.filter(
    (row) => row.result?.state === "review" && !!row.compileEvidence,
  );
  const tools = rows.filter((row) => !!row.result?.tool);
  return {
    missions: percent(rows, (row) => row.status === "passed"),
    fixtureInvalid: rows.filter((row) => row.status === "fixture-invalid")
      .length,
    fullWorkflowSuccess: percent(rows, (row) => row.fullWorkflowSuccess),
    structuredProviderTruthfulness: percent(
      rows,
      (row) => row.providerTruthfulnessPassed,
    ),
    routeAccuracy: percent(rows, (row) => row.routeAccurate),
    exactPermissions: percent(rows, (row) => row.permissionExact),
    postconditions: percent(rows, (row) => row.postconditionSuccess),
    correctSemanticRefusal: percent(
      rows.filter((row) =>
        row.predicates.some((p) =>
          ["connectionRequest", "unsupportedExplanation"].includes(p.kind),
        ),
      ),
      (row) => row.semanticRefusal,
    ),
    correctClarification: percent(
      rows.filter((row) =>
        row.predicates.some((p) => p.kind === "clarificationQuestion"),
      ),
      (row) => row.correctClarification,
    ),
    execution: percent(executable, (row) => row.executionSuccess),
    runtimeVerified: percent(executable, (row) => row.runtimeVerified),
    persistence: percent(tools, (row) => row.persisted),
    executionDoneWithFailedGoal: percent(
      executable,
      (row) => row.executionDoneWithFailedGoal,
    ),
    verifiedWithFailedGoal: percent(
      executable,
      (row) => row.verifiedWithFailedGoal,
    ),
    executionFailedWithSatisfiedGoal: percent(
      executable,
      (row) => row.executionFailedWithSatisfiedGoal,
    ),
    duplicateSideEffectCount: rows.reduce(
      (sum, row) => sum + row.duplicateWrites,
      0,
    ),
    forbiddenReplayWrites: rows.reduce(
      (sum, row) => sum + row.forbiddenReplayWrites,
      0,
    ),
    generationPolicy: percent(rows, (row) => row.generationPolicyPassed),
    sideEffectPolicy: percent(rows, (row) => row.sideEffectPolicyPassed),
    stages: {
      groundedDraftObserved: percent(
        rows,
        (row) => row.stageMetrics.groundedDraftObserved,
      ),
      typedCompilationObserved: percent(
        rows,
        (row) => row.stageMetrics.typedCompilationObserved,
      ),
      firstPassBuild: percent(
        rows.filter((row) => row.stageMetrics.firstPassBuild !== null),
        (row) => row.stageMetrics.firstPassBuild === true,
      ),
      buildAfterRepairOne: percent(
        rows.filter((row) => row.stageMetrics.buildAfterRepairOne !== null),
        (row) => row.stageMetrics.buildAfterRepairOne === true,
      ),
      buildAfterRepairTwo: percent(
        rows.filter((row) => row.stageMetrics.buildAfterRepairTwo !== null),
        (row) => row.stageMetrics.buildAfterRepairTwo === true,
      ),
      replayPassed: percent(compiled, (row) => row.stageMetrics.replayPassed),
    },
    retrieval: {
      applicable: rows.filter((row) => row.retrieval.expectedIds.length).length,
      casesWithDistractors: rows.filter(
        (row) => row.retrieval.includesDistractors,
      ).length,
      recallAt1: mean(rows.map((row) => row.retrieval.recallAt1)),
      recallAt3: mean(rows.map((row) => row.retrieval.recallAt3)),
      mrr: mean(rows.map((row) => row.retrieval.reciprocalRank)),
      limitation:
        "Report candidate counts and distractor coverage; small seeded candidate sets do not establish hard-negative retrieval quality",
    },
    providerAccounting: Object.fromEntries(
      [
        "planningAttempts",
        "transportRequestsAttempted",
        "knownInferenceRequests",
        "attemptsWithUnknownUsage",
        "inputTokensKnown",
        "outputTokensKnown",
        "attemptsWithIncompleteTokenUsage",
      ].map((key) => [
        key,
        rows.reduce(
          (sum, row) =>
            sum +
            row.providerAccounting[key as keyof Row["providerAccounting"]],
          0,
        ),
      ]),
    ),
    latencyMs: Object.fromEntries(
      [...new Set(rows.flatMap((row) => Object.keys(row.timings)))].map(
        (stage) => [
          stage,
          {
            count: rows.filter((row) => Number.isFinite(row.timings[stage]))
              .length,
            p50: quantile(
              rows.map((row) => row.timings[stage]).filter(Number.isFinite),
              0.5,
            ),
            p95: quantile(
              rows.map((row) => row.timings[stage]).filter(Number.isFinite),
              0.95,
            ),
          },
        ],
      ),
    ),
    categories: Object.fromEntries(
      [...new Set(rows.map((row) => row.family))].map((family) => [
        family,
        percent(
          rows.filter((row) => row.family === family),
          (row) => row.status === "passed",
        ),
      ]),
    ),
  };
}
function mean(values: (number | null)[]) {
  const numbers = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  return numbers.length
    ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
    : null;
}
export async function main(argv = process.argv.slice(2)) {
  const options = parseHoldoutOptions(argv);
  if (!options) {
    process.stdout.write(
      "Evaluation-only runner: --freeze=manifest.json --provider=recorded|local [--limit=10..100 for local] [--out=directory]. No sealed data is read by --help.\n",
    );
    return;
  }
  process.env.FORGE_FREE_ONLY = "true";
  const { freeze, seal, freezeHash } = await verifyFreeze(options.freeze);
  const stamp = new NativeDate()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  const output = resolve(
    ROOT,
    options.out ?? "artifacts/core-holdout/" + stamp + "-" + options.provider,
  );
  const relativeToSeal = relative(SEALED, output);
  if (!relativeToSeal.startsWith("..") && !isAbsolute(relativeToSeal))
    throw new Error("Results must be outside the immutable sealed directory");
  try {
    await stat(output);
    throw new Error(
      "Choose a new output directory; prior evidence must not be overwritten",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(output, { recursive: true });
  const cases = await jsonl<HoldoutCase>(join(SEALED, "missions.sealed.jsonl"));
  if (
    cases.length !== seal.total ||
    new Set(cases.map((row) => row.id)).size !== seal.total
  )
    throw new Error("Sealed corpus IDs/count are invalid");
  const selected = selectHoldoutCases(cases, options.limit ?? 100);
  await json(join(output, "run-plan.json"), {
    createdAt: new NativeDate().toISOString(),
    freeze,
    freezeHash,
    seal: seal.contentSealSha256,
    provider: options.provider,
    evidenceClass:
      options.provider === "recorded"
        ? "authored-recording-offline-integration-not-model-inference"
        : "fresh-local-cached-model-inference",
    selection: {
      algorithm:
        "Round robin sorted families; within family SHA256(forge-core-holdout-v1:<id>), fixed before reading oracle/results",
      ids: selected.map((row) => row.id),
    },
    cost: {
      paidCloudCallsAllowed: 0,
      externalNetworkAllowed: false,
      loopbackLocalInferenceAllowed: options.provider === "local",
    },
    runnerHashes: await Promise.all(
      [
        "scripts/evaluate-core-holdout.ts",
        "evaluation/core-holdout-runner/fixtures.ts",
      ].map(async (path) => ({
        path,
        sha256: sha256(await readFile(resolve(ROOT, path))),
      })),
    ),
    limitations: [
      "Recordings are model-authored fixtures, not fresh inference",
      "Semantic clarification/connection/refusal checks include disclosed lexical heuristics",
      "Legacy recordings are never augmented with oracle-derived source or postconditions",
      "Runtime verification is scored separately from independent oracle success",
      "Synthetic external services persist through evaluator fixture snapshots; local files use the real WorkspaceConnector",
      "First-pass build rates measure pipeline admission, not isolated first-pass compilation; unavailable stages are not assigned zero latency",
      "endToEndMs includes fixture setup and all duplicate/reload/scheduler checks; timeToNewToolMs measures automatic ask-to-review without setup",
      "Mission pass preserves the sealed predicate; fullWorkflowSuccess additionally requires successful returned execution for tool cases",
    ],
  });
  const oracles = new Map(
    (await jsonl<Oracle>(join(SEALED, "expected.sealed.jsonl"))).map((row) => [
      row.id,
      row,
    ]),
  );
  const recordings =
    options.provider === "recorded"
      ? new Map(
          (
            await jsonl<Recording>(
              join(SEALED, "recorded-solutions.sealed.jsonl"),
            )
          ).map((row) => [row.id, row]),
        )
      : new Map<string, Recording>();
  const restoreNetwork = denyExternalNetwork(options.provider),
    rows: Row[] = [];
  try {
    for (const mission of selected) {
      process.stdout.write(
        JSON.stringify({ starting: mission.id, provider: options.provider }) +
          "\n",
      );
      const oracle = oracles.get(mission.id);
      if (!oracle) throw new Error("Missing immutable evaluator row");
      const row = await executeCase(
        mission,
        oracle,
        recordings.get(mission.id),
        options,
        join(output, mission.id),
      );
      rows.push(row);
      process.stdout.write(
        JSON.stringify({
          finished: mission.id,
          status: row.status,
          durationMs: Math.round(row.timings.endToEndMs),
        }) + "\n",
      );
      await json(join(output, "results.partial.json"), {
        completed: rows.length,
        planned: selected.length,
        rows,
      });
    }
  } finally {
    restoreNetwork();
    globalThis.Date = NativeDate;
  }
  // Detect source edits during the run instead of silently attributing a moving target.
  let sourceStillFrozen = true,
    sourceChangeError: string | undefined;
  try {
    await verifyFreeze(options.freeze);
  } catch (error) {
    sourceStillFrozen = false;
    sourceChangeError = errorText(error);
  }
  const report = {
    createdAt: new NativeDate().toISOString(),
    provider: options.provider,
    evidenceClass:
      options.provider === "recorded"
        ? "authored-recording-offline-integration-not-model-inference"
        : "fresh-local-cached-model-inference",
    sourceStillFrozen,
    sourceChangeError,
    freezeHash,
    holdoutSealSha256: seal.contentSealSha256,
    summary: summarizeHoldoutRows(rows),
    rows,
  };
  await json(join(output, "results.json"), report);
  process.stdout.write(
    JSON.stringify({
      report: relative(ROOT, join(output, "results.json")),
      sourceStillFrozen,
      summary: report.summary,
    }) + "\n",
  );
  if (!sourceStillFrozen) process.exitCode = 2;
  else if (
    rows.some((row) => row.status !== "passed" || !row.fullWorkflowSuccess)
  )
    process.exitCode = 1;
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch((error) => {
    process.stderr.write(errorText(error) + "\n");
    process.exitCode = 1;
  });
