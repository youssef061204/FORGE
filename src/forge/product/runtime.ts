import { randomUUID } from "node:crypto";
import { z } from "zod";
import { digest } from "../hash";
import type { StateStore } from "../store";
import { compileExecutable, runProgramExecutable } from "../executable";
import { ConnectorFabric } from "./fabric";
import {
  emptyProductState,
  programDraftSchema,
  programSchema,
  programInputSchema,
  solutionSchema,
  type Program,
  type ProgramDraft,
  type ProgramInput,
  type ProgramOutput,
  type ProductState,
  type ProgramRun,
  type Receipt,
  type SolutionRoute,
  type RunVerification,
} from "./contracts";
import type { MissionModel, ModelUsage, PlanningContext } from "./provider";
import { boundJson, validateJson } from "./schemas";
import { retrievePrograms } from "./retrieval";
import { ConnectorHttpError } from "./network";
import { workspaceSummary, workspaceEffectValue } from "./workspace";
import {
  validateProposedPostconditions,
  verifyCommittedRun,
  type CommittedEffect,
} from "./verification";

export function programHash(
  program: Pick<
    Program,
    | "id"
    | "version"
    | "goal"
    | "source"
    | "reads"
    | "actions"
    | "trigger"
    | "permissions"
    | "bindings"
    | "tests"
  > & {
    provenance?: Program["provenance"];
    parentHash?: string;
    postconditions?: Program["postconditions"];
    representation?: Program["representation"];
  },
) {
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
  } = program;
  return digest({
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
    ...(program.provenance?.length ? { provenance: program.provenance } : {}),
    ...(program.parentHash ? { parentHash: program.parentHash } : {}),
    ...(program.postconditions !== undefined
      ? { postconditions: program.postconditions }
      : {}),
    ...(program.representation !== undefined
      ? { representation: program.representation }
      : {}),
  });
}
const inactive = [
  "review",
  "blocked",
  "rejected",
  "superseded",
  "revoked",
  "paused",
];
type Build = {
  id: string;
  status: string;
  stages: { name: string; at: string; durationMs?: number }[];
  attempts?: {
    index: number;
    status: "running" | "succeeded" | "failed";
    durationMs: number;
    diagnostic?: string;
    structuredDiagnostic?: AttemptDiagnostic;
    usage?: ModelUsage;
  }[];
};
export type AttemptDiagnostic = {
  stage:
    | "intent"
    | "plan"
    | "generation"
    | "verification"
    | "provider"
    | "schema"
    | "routing"
    | "grounding"
    | "compilation"
    | "tests"
    | "replay"
    | "persistence";
  path?: string;
  code: string;
  message: string;
  retryable: boolean;
};
function attemptDiagnostic(
  error: unknown,
  phase: string,
  stage: string,
  retryable: boolean,
): AttemptDiagnostic {
  const supplied = z
    .object({
      stage: z.enum([
        "intent",
        "grounding",
        "plan",
        "generation",
        "compilation",
        "verification",
        "provider",
        "schema",
        "routing",
        "tests",
        "replay",
        "persistence",
      ]),
      code: z.string().min(1).max(100),
      message: z.string().min(1).max(1200),
      path: z.string().max(300).optional(),
      retryable: z.boolean(),
    })
    .safeParse((error as { diagnostic?: unknown } | null)?.diagnostic);
  if (supplied.success) return { ...supplied.data, retryable };
  const message = (
    error instanceof Error
      ? error.message
      : "The proposed software failed validation"
  ).slice(0, 1200);
  const firstStage: AttemptDiagnostic["stage"] =
    phase === "model"
      ? "provider"
      : phase === "persistence" || phase === "settling"
        ? "persistence"
        : error instanceof z.ZodError
          ? "schema"
          : stage === "Grounding connected operations"
            ? "grounding"
            : stage === "Compiling the tool"
              ? "compilation"
              : stage === "Testing the tool"
                ? "tests"
                : stage === "Checking recent data"
                  ? "replay"
                  : "routing";
  return {
    stage: firstStage,
    code: firstStage.toUpperCase() + "_FAILED",
    message,
    retryable,
  };
}
function accumulatedUsage(
  previous: ModelUsage | undefined,
  current: ModelUsage,
): ModelUsage {
  if (!previous) return { ...current };
  return {
    ...current,
    calls: previous.calls + current.calls,
    inputTokens: previous.inputTokens + current.inputTokens,
    outputTokens: previous.outputTokens + current.outputTokens,
    durationMs: previous.durationMs + current.durationMs,
    tokensComplete:
      previous.tokensComplete !== false && current.tokensComplete !== false,
    ...(previous.stageTimings || current.stageTimings
      ? {
          stageTimings: Object.fromEntries(
            [
              ...new Set([
                ...Object.keys(previous.stageTimings ?? {}),
                ...Object.keys(current.stageTimings ?? {}),
              ]),
            ].map((key) => [
              key,
              (previous.stageTimings?.[key] ?? 0) +
                (current.stageTimings?.[key] ?? 0),
            ]),
          ),
        }
      : {}),
  };
}
function repairContext(
  error: unknown,
  previousProgram: unknown,
  structuredDiagnostic: AttemptDiagnostic,
) {
  const diagnostic = (
    error instanceof Error
      ? error.message
      : "The proposed software failed validation"
  ).slice(0, 1200);
  let proposal = "No parseable proposed program was returned.";
  try {
    if (previousProgram !== undefined)
      proposal = JSON.stringify(previousProgram).slice(0, 12000);
  } catch {
    /* Diagnostics remain usable even for an invalid non-JSON response. */
  }
  return `The previous attempt failed. Generate one complete corrected solution; do not claim the failed attempt was installed. No permissions or writes were granted.\nStructured diagnostic: ${JSON.stringify(structuredDiagnostic)}\nDiagnostic: ${diagnostic}\nPrevious proposed program (untrusted, bounded): ${proposal}`.slice(
    0,
    14000,
  );
}
export type GoalResult = {
  state: "offline" | "connect" | "clarify" | "unsupported" | "reuse" | "review";
  explanation: string;
  route?: SolutionRoute;
  tool?: Program;
  missingConnections?: string[];
  buildId: string;
  resources: Awaited<ReturnType<ConnectorFabric["discover"]>>;
  usage?: ModelUsage;
  permissionDelta?: string[];
};

export class ProductRuntime {
  readonly builds = new Map<string, Build>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(
    readonly store: StateStore,
    readonly fabric: ConnectorFabric,
    readonly model: MissionModel,
    readonly sandboxMode: "process" | "docker" = "process",
    readonly requestCap = Number(process.env.FORGE_MISSION_REQUEST_CAP ?? 0),
  ) {
    if (!Number.isInteger(requestCap) || requestCap < 0 || requestCap > 500)
      throw new Error(
        "FORGE_MISSION_REQUEST_CAP must be an explicit bounded count from zero to 500",
      );
    if (
      model.maximumAttempts !== undefined &&
      (!Number.isInteger(model.maximumAttempts) ||
        model.maximumAttempts < 1 ||
        model.maximumAttempts > 3)
    )
      throw new Error(
        "The model maximumAttempts must be an explicit integer from one to three",
      );
  }
  async initialize() {
    await this.store.transaction((state) => {
      state.product ??= emptyProductState();
    });
  }
  private async product() {
    const state = await this.store.read();
    return state.product ?? emptyProductState();
  }
  async snapshot() {
    const [product, resources, planner] = await Promise.all([
      this.product(),
      this.fabric.discover(),
      this.model.status(),
    ]);
    const { outbox, executionPlans, triggerEvents, workspace, ...visible } =
      product;
    return {
      ...visible,
      workspace: workspaceSummary(workspace),
      executionLedger: {
        plans: Object.keys(executionPlans).length,
        capacity: 500,
        writes: Object.keys(outbox).length,
        uncertainWrites: Object.values(outbox).filter(
          (entry) => entry.status === "uncertain" || entry.status === "pending",
        ).length,
        deliveredTriggers: Object.values(triggerEvents).filter(
          (event) => event.status === "done",
        ).length,
        failedTriggers: Object.values(triggerEvents).filter(
          (event) => event.status === "failed",
        ).length,
      },
      resources,
      planner: {
        ...planner,
        mode: this.model.mode,
        requestCap: this.requestCap,
        requestsUsed: product.providerRequests.length,
      },
      authority:
        "Owner-scoped connector operations; credentials never enter generated source",
      schedulerBackend: "local",
    };
  }
  progress(id: string) {
    return this.builds.get(id);
  }
  private stage(build: Build, name: string) {
    const now = new Date().toISOString();
    const previous = build.stages.at(-1);
    if (previous)
      previous.durationMs = Date.parse(now) - Date.parse(previous.at);
    build.stages.push({ name, at: now });
  }
  private async conversation(
    role: "user" | "forge",
    text: string,
    toolId?: string,
  ) {
    await this.store.transaction((state) => {
      const product = (state.product ??= emptyProductState());
      product.conversation.push({
        id: randomUUID(),
        role,
        text: text.slice(0, 4000),
        at: new Date().toISOString(),
        ...(toolId ? { toolId } : {}),
      });
      product.conversation = product.conversation.slice(-100);
      if (toolId) product.lastToolId = toolId;
    });
  }
  async ask(
    goal: string,
    buildId: string = randomUUID(),
    followUpId?: string,
  ): Promise<GoalResult> {
    z.string().min(5).max(4000).parse(goal);
    if (this.builds.has(buildId)) throw new Error("Build already exists");
    if (this.builds.size > 20) {
      const finished = [...this.builds].find(
        ([, b]) => b.status !== "building",
      );
      if (finished) this.builds.delete(finished[0]);
    }
    const build: Build = { id: buildId, status: "building", stages: [] };
    this.builds.set(buildId, build);
    await this.conversation("user", goal);
    try {
      this.stage(build, "Checking what I can use");
      const resources = await this.fabric.discover();
      this.stage(build, "Looking for an existing tool");
      const product = await this.product();
      const exact = product.programs.find(
        (p) =>
          !inactive.includes(p.status) &&
          (!followUpId || p.id === followUpId) &&
          p.goal.trim().toLowerCase() === goal.trim().toLowerCase(),
      );
      if (exact) {
        this.assertBindings(exact);
        this.assertHash(exact);
        const explanation = `${exact.name} is already installed. You can run it now.`;
        await this.conversation("forge", explanation, exact.id);
        build.status = "ready";
        this.stage(build, "Existing tool is ready");
        return {
          state: "reuse",
          route: "REUSE",
          explanation,
          tool: exact,
          buildId,
          resources,
        };
      }
      const status = await this.model.status();
      if (
        !status.ready ||
        this.model.mode === "offline" ||
        (this.model.mode === "live" && this.requestCap === 0)
      ) {
        const explanation =
          this.model.mode === "live" && status.ready && this.requestCap === 0
            ? "Live planning needs a configured request budget. Set the Bedrock request cap in server configuration; your installed tools remain available."
            : (status.reason ??
              "FORGE is offline. Connect Amazon Bedrock to build a tool.");
        await this.conversation("forge", explanation);
        build.status = "offline";
        this.stage(build, "Planning is offline");
        return { state: "offline", explanation, buildId, resources };
      }
      const retrieved = retrievePrograms(goal, product.programs);
      const previous = product.programs.find(
        (p) =>
          p.id === (followUpId ?? product.lastToolId) &&
          !["revoked", "rejected", "blocked", "review", "superseded"].includes(
            p.status,
          ),
      );
      if (followUpId && !previous)
        throw new Error(
          "The tool selected for editing is unavailable; no new tool was generated",
        );
      const context: PlanningContext = {
        buildId,
        now: new Date().toISOString(),
        timeZone: process.env.FORGE_TIME_ZONE ?? "America/Toronto",
        goal,
        resources,
        existing: [
          ...new Map(
            [
              ...(followUpId && previous ? [previous] : []),
              ...retrieved.map((r) => r.program),
              ...(!followUpId && previous ? [previous] : []),
            ].map((p) => [p.id, p]),
          ).values(),
        ]
          .slice(0, 4)
          .map(
            ({
              id,
              name,
              description,
              goal,
              version,
              source,
              reads,
              actions,
              trigger,
              postconditions,
              representation,
              status,
              permissions,
            }) => ({
              id,
              name,
              description,
              goal,
              version,
              source,
              reads,
              actions,
              trigger,
              ...(postconditions !== undefined ? { postconditions } : {}),
              ...(representation !== undefined ? { representation } : {}),
              status,
              permissions,
            }),
          ),
        conversation: product.conversation.slice(-6),
        ...(previous ? { followUpId: previous.id } : {}),
        ...(followUpId ? { editTargetId: followUpId } : {}),
      };
      this.stage(build, "Planning the request");
      let usageTotal: ModelUsage | undefined;
      let failure: string | undefined;
      const maximumAttempts =
        this.model.maximumAttempts ?? (this.model.mode === "local" ? 2 : 1);
      for (let attempt = 0; attempt < maximumAttempts; attempt++) {
        const started = performance.now();
        const record: NonNullable<Build["attempts"]>[number] = {
          index: attempt + 1,
          status: "running",
          durationMs: 0,
        };
        (build.attempts ??= []).push(record);
        let phase: "model" | "validation" | "persistence" | "settling" =
          "model";
        let previousProgram: unknown;
        try {
          const planned = await this.plan({
            ...context,
            ...(failure ? { failure } : {}),
          });
          previousProgram = planned.solution?.program;
          record.usage = planned.usage;
          usageTotal = accumulatedUsage(usageTotal, planned.usage);
          const solution = solutionSchema.parse(planned.solution);
          const usage = usageTotal;
          phase = "validation";
          if (
            context.editTargetId &&
            (!["EXTEND", "CONNECT", "CLARIFY", "UNSUPPORTED"].includes(
              solution.route,
            ) ||
              (solution.route === "EXTEND" &&
                (solution.existingIds.length !== 1 ||
                  solution.existingIds[0] !== context.editTargetId)))
          )
            throw new Error(
              "An explicit edit must extend the selected tool or explain the missing connection or detail; no unrelated tool was created",
            );
          if (
            solution.route === "UNSUPPORTED" &&
            (solution.program ||
              solution.existingIds.length ||
              solution.missingConnections.length)
          )
            throw new Error(
              "UNSUPPORTED explains an unavailable behavior without a program, tool reuse or connection claim",
            );
          if (
            solution.route === "CLARIFY" &&
            (solution.program || !solution.question?.trim())
          )
            throw new Error(
              "CLARIFY must ask a specific question and cannot contain a proposed program",
            );
          if (
            solution.route === "CONNECT" &&
            (solution.program ||
              !solution.missingConnections.length ||
              solution.missingConnections.some((name) => !name.trim()))
          )
            throw new Error(
              "CONNECT must identify the missing connections and cannot contain a proposed program",
            );
          if (
            solution.route === "REUSE" &&
            (solution.program || solution.existingIds.length !== 1)
          )
            throw new Error(
              "REUSE must identify exactly one existing tool without a new program",
            );
          if (solution.route === "EXTEND" && solution.existingIds.length !== 1)
            throw new Error("EXTEND must identify exactly one existing tool");
          if (solution.route === "SYNTHESIZE" && solution.existingIds.length)
            throw new Error(
              "SYNTHESIZE cannot claim existing tool contributors",
            );
          if (
            solution.route === "CONNECT" ||
            solution.route === "CLARIFY" ||
            solution.route === "UNSUPPORTED"
          ) {
            const explanation =
              solution.route === "UNSUPPORTED"
                ? solution.explanation
                : (solution.question ?? solution.explanation);
            phase = "settling";
            await this.conversation("forge", explanation);
            record.status = "succeeded";
            record.durationMs = performance.now() - started;
            build.status = "ready";
            this.stage(
              build,
              solution.route === "CONNECT"
                ? "Connection needed"
                : solution.route === "UNSUPPORTED"
                  ? "This request is unsupported"
                  : "A detail is needed",
            );
            return {
              state:
                solution.route === "CONNECT"
                  ? "connect"
                  : solution.route === "UNSUPPORTED"
                    ? "unsupported"
                    : "clarify",
              route: solution.route,
              explanation,
              missingConnections: solution.missingConnections,
              buildId,
              resources,
              usage,
            };
          }
          if (solution.route === "REUSE") {
            const existing = product.programs.find(
              (p) =>
                p.id === solution.existingIds[0] &&
                !inactive.includes(p.status),
            );
            if (!existing)
              throw new Error(
                "The suggested tool is unavailable; no new authority was granted",
              );
            this.assertBindings(existing);
            this.assertHash(existing);
            phase = "settling";
            await this.conversation("forge", solution.explanation, existing.id);
            record.status = "succeeded";
            record.durationMs = performance.now() - started;
            build.status = "ready";
            this.stage(build, "Existing tool is ready");
            return {
              state: "reuse",
              route: "REUSE",
              explanation: solution.explanation,
              tool: existing,
              buildId,
              resources,
              usage,
            };
          }
          if (["OPTIMIZE", "LEARNED_POLICY"].includes(solution.route))
            throw new Error(
              "Use FORGE Twin to compare the existing operational strategies and their evidence",
            );
          const parent =
            solution.route === "EXTEND"
              ? product.programs.find(
                  (p) =>
                    p.id === solution.existingIds[0] &&
                    ![
                      "revoked",
                      "superseded",
                      "rejected",
                      "blocked",
                      "review",
                    ].includes(p.status),
                )
              : undefined;
          if (solution.route === "EXTEND" && !parent)
            throw new Error("Choose an existing tool before editing it");
          if (
            solution.route === "COMPOSE" &&
            (solution.existingIds.length < 2 ||
              solution.existingIds.some(
                (id) =>
                  !product.programs.some(
                    (p) => p.id === id && !inactive.includes(p.status),
                  ),
              ))
          )
            throw new Error(
              "Composition must identify its available contributing tools",
            );
          this.stage(
            build,
            parent ? "Building the updated tool" : "Building the tool",
          );
          const draft = programDraftSchema.parse(solution.program);
          const contributors =
            solution.route === "COMPOSE"
              ? [...new Set(solution.existingIds)].map((id) =>
                  product.programs.find(
                    (p) => p.id === id && !inactive.includes(p.status),
                  )!,
                )
              : [];
          if (solution.route === "COMPOSE" && contributors.length < 2)
            throw new Error(
              "Composition needs two distinct contributing tools",
            );
          for (const contributor of contributors) {
            this.assertHash(contributor);
            this.assertBindings(contributor);
          }
          const tool = await this.stageProgram(
            goal,
            draft,
            usage,
            build,
            parent,
            contributors.map(({ id, version, hash }) => ({
              id,
              version,
              hash,
            })),
            () => {
              phase = "persistence";
            },
          );
          phase = "settling";
          record.status = "succeeded";
          record.durationMs = performance.now() - started;
          await this.conversation(
            "forge",
            `${tool.name} is tested and ready for your approval.`,
            tool.id,
          );
          build.status = "ready";
          this.stage(build, "Ready for approval");
          return {
            state: "review",
            route: solution.route,
            explanation: tool.actions.length
              ? `Ready for review. Proposed actions: ${tool.actions.map((id) => this.fabric.operation(id).name).join(", ")}. Nothing has run.`
              : "Ready for review. This tool proposes no changes.",
            tool,
            buildId,
            resources,
            usage,
            permissionDelta: tool.permissions.filter(
              (permission) => !parent?.permissions.includes(permission),
            ),
          };
        } catch (error) {
          record.status = "failed";
          record.durationMs = performance.now() - started;
          record.diagnostic = (
            error instanceof Error ? error.message : "Validation failed"
          ).slice(0, 1200);
          const metadata = error as {
            usage?: ModelUsage;
            proposedProgram?: unknown;
            proposedSolution?: { program?: unknown };
            diagnostic?: { retryable?: boolean };
          } | null;
          if (!record.usage && metadata?.usage) {
            record.usage = metadata.usage;
            usageTotal = accumulatedUsage(usageTotal, metadata.usage);
          }
          previousProgram ??=
            metadata?.proposedProgram ?? metadata?.proposedSolution?.program;
          const invalidModelResponse =
            phase === "model" &&
            (error instanceof z.ZodError ||
              error instanceof SyntaxError ||
              Boolean(metadata?.usage && !metadata.usage.schemaValidated));
          const retryable =
            (phase === "validation" ||
              (phase === "model" && metadata?.diagnostic
                ? metadata.diagnostic.retryable === true
                : invalidModelResponse)) &&
            (this.model.mode === "local" ||
              this.model.maximumAttempts !== undefined);
          record.structuredDiagnostic = attemptDiagnostic(
            error,
            phase,
            build.stages.at(-1)?.name ?? "",
            retryable,
          );
          if (!retryable || attempt + 1 >= maximumAttempts) throw error;
          this.stage(
            build,
            `${this.model.mode === "local" ? "Local" : "Compiler"} attempt ${attempt + 1} failed: ${record.diagnostic.slice(0, 180)}`,
          );
          failure = repairContext(
            error,
            previousProgram,
            record.structuredDiagnostic,
          );
          this.stage(
            build,
            this.model.mode === "local"
              ? "Generating one corrected local response"
              : "Generating a corrected response",
          );
        }
      }
      throw new Error(
        "The bounded compiler stopped without an accepted response",
      );
    } catch (error) {
      build.status = "failed";
      this.stage(build, "Stopped before installation");
      throw error;
    } finally {
      this.model.finishBuild?.(buildId);
    }
  }
  private async plan(context: PlanningContext) {
    const id = randomUUID();
    if (this.model.mode === "live")
      await this.store.transaction((state) => {
        const product = (state.product ??= emptyProductState());
        if (product.providerRequests.length >= this.requestCap)
          throw new Error(
            "The configured Bedrock request budget is exhausted. No fixture planner was used.",
          );
        product.providerRequests.push({
          id,
          at: new Date().toISOString(),
          status: "started",
        });
      });
    try {
      const result = await this.model.plan(context);
      if (this.model.mode === "live")
        await this.store.transaction((state) => {
          const request = state.product!.providerRequests.find(
            (r) => r.id === id,
          )!;
          request.status = "succeeded";
          request.requestId = result.usage.requestId;
        });
      return result;
    } catch (error) {
      if (this.model.mode === "live")
        await this.store.transaction((state) => {
          state.product!.providerRequests.find((r) => r.id === id)!.status =
            "failed";
        });
      throw error;
    }
  }
  private assertHash(program: Program) {
    if (programHash(program) !== program.hash)
      throw new Error(
        "Tool source or permission metadata changed; rebuild before granting access",
      );
  }
  private assertBindings(program: Program) {
    for (const id of program.connectors) {
      const connector = this.fabric.descriptor(id);
      if (
        connector.status !== "connected" ||
        connector.binding !== program.bindings[id]
      )
        throw new Error(
          `Reconnect ${connector.name} and approve this tool again; its connection identity changed`,
        );
    }
  }
  private authority(product: ProductState, id: string, hash?: string) {
    const program = product.programs.find(
      (p) =>
        p.id === id &&
        !["superseded", "review", "blocked", "rejected"].includes(p.status),
    );
    if (
      !program ||
      inactive.includes(program.status) ||
      (hash && hash !== program.hash) ||
      program.permissions.some(
        (permission) => !program.grants.includes(permission),
      )
    )
      throw new Error("Tool access is paused, revoked, unapproved or changed");
    this.assertHash(program);
    this.assertBindings(program);
    return program;
  }
  private async observe(
    draft: ProgramDraft,
    eventId: string,
    now: string,
    installed?: Program,
  ) {
    const observations: Record<string, unknown> = {};
    for (const read of draft.reads) {
      const invoke = (workspace?: ProductState["workspace"]) =>
        this.fabric.invoke(read.operation, read.arguments, {
          key: digest({ eventId, read }),
          mode: "replay",
          now,
          observations,
          workspace,
        });
      const result = installed
        ? await this.store.transaction(async (state) => {
            this.authority(state.product!, installed.id, installed.hash);
            return invoke(state.product!.workspace);
          })
        : await invoke();
      observations[read.ref] = result.data;
    }
    boundJson(observations);
    return observations;
  }
  private async validateOutput(
    draft: ProgramDraft,
    output: ProgramOutput,
    input: ProgramInput,
    eventId: string,
  ) {
    boundJson(output, 8192);
    const seen = new Set<string>();
    for (const action of output.operations) {
      if (!draft.actions.includes(action.operation))
        throw new Error(
          "Generated program requested an undeclared operation; no changes were made",
        );
      const key = digest(action);
      if (seen.has(key))
        throw new Error(
          "Generated program proposed an identical write twice; no changes were made",
        );
      seen.add(key);
      await this.fabric.preflight(action.operation, action.arguments, {
        key: digest({ eventId, action }),
        mode: "replay",
        now: input.now,
        observations: input.observations,
      });
    }
    validateProposedPostconditions(draft, output);
  }
  private async stageProgram(
    goal: string,
    draft: ProgramDraft,
    usage: ModelUsage,
    build: Build,
    parent?: Program,
    provenance: Program["provenance"] = parent?.provenance ?? [],
    onValidated?: () => void,
  ) {
    this.stage(build, "Grounding connected operations");
    const metadata = this.fabric.validateDraft(draft);
    const types = this.fabric.types(draft);
    this.stage(build, "Compiling the tool");
    const started = performance.now();
    compileExecutable(draft.source, "program/v1", types);
    const compileMs = performance.now() - started;
    this.stage(build, "Testing the tool");
    const sandboxStart = performance.now();
    const checks: Program["evidence"]["checks"] = [
      {
        name: "Typed executable compilation",
        passed: true,
        details:
          "One bounded synchronous function; no credentials, network or filesystem",
      },
      {
        name: "Exact connector permissions",
        passed: true,
        details: metadata.permissions.join(", "),
      },
    ];
    const failedAttempts =
      build.attempts?.filter((attempt) => attempt.status === "failed").length ??
      0;
    if (failedAttempts)
      checks.push({
        name:
          this.model.mode === "local"
            ? "Bounded local repair"
            : "Bounded compiler repair",
        passed: true,
        details: `A new ${this.model.mode === "local" ? "local " : ""}response underwent the full checks after ${failedAttempts} failed attempt; source was not patched by the host`,
      });
    for (const test of draft.tests) {
      for (const effect of test.expectedEffects ?? []) {
        if (!draft.actions.includes(effect.operation))
          throw new Error(
            "Test expectation requested an undeclared write operation",
          );
        validateJson(
          this.fabric.operation(effect.operation).inputSchema,
          effect.arguments,
          "Expected effect arguments",
        );
      }
      for (const read of draft.reads)
        validateJson(
          this.fabric.operation(read.operation).outputSchema,
          test.input.observations[read.ref],
          `Synthetic observation ${read.ref} for ${read.operation}`,
        );
      const output = await runProgramExecutable(
        draft.source,
        test.input,
        types,
        this.sandboxMode,
      );
      // Synthetic tests validate schemas, not current real connection targets.
      for (const action of output.operations) {
        if (!draft.actions.includes(action.operation))
          throw new Error("Test requested an undeclared action");
        validateJson(
          this.fabric.operation(action.operation).inputSchema,
          action.arguments,
          "Test action",
        );
      }
      if (
        JSON.stringify(output.operations.map((o) => o.operation)) !==
        JSON.stringify(test.expectedOperations)
      )
        throw new Error(
          `Executable test ${JSON.stringify(test.name)} expected operations ${JSON.stringify(test.expectedOperations)} but proposed ${JSON.stringify(output.operations.map((action) => action.operation))}`,
        );
      if (test.expectedEffects) {
        const effectValue = (effect: ProgramOutput["operations"][number]) =>
          effect.operation === "workspace.save"
            ? { ...effect, arguments: workspaceEffectValue(effect.arguments) }
            : effect;
        const actualEffects = output.operations.map(effectValue);
        const expectedEffects = test.expectedEffects.map(effectValue);
        if (digest(actualEffects) !== digest(expectedEffects))
          throw new Error(
            `Generated program did not match the expected write arguments in test ${test.name}. Expected ${JSON.stringify(expectedEffects).slice(0, 400)}; proposed ${JSON.stringify(actualEffects).slice(0, 400)}`,
          );
      }
      if (test.expectedOutput && digest(output) !== digest(test.expectedOutput))
        throw new Error(
          "Generated program did not match the exact expected behavior in its tests",
        );
      checks.push({
        name: test.name,
        passed: true,
        details: `${output.operations.length} proposed operations; zero external writes`,
      });
    }
    const sandboxMs = performance.now() - sandboxStart;
    this.stage(build, "Checking recent data");
    const now = new Date().toISOString();
    const observations = await this.observe(draft, "replay:" + build.id, now);
    const input = programInputSchema.parse({
      now,
      input: {
        timeZone: process.env.FORGE_TIME_ZONE ?? "America/Toronto",
        localHour: Number(
          new Intl.DateTimeFormat("en-CA", {
            timeZone: process.env.FORGE_TIME_ZONE ?? "America/Toronto",
            hour: "numeric",
            hourCycle: "h23",
          }).format(new Date(now)),
        ),
      },
      observations,
      state: {},
    });
    const output = await runProgramExecutable(
      draft.source,
      input,
      types,
      this.sandboxMode,
    );
    await this.validateOutput(draft, output, input, build.id);
    const observationsCount = Object.values(observations).reduce<number>(
      (sum, value) =>
        sum +
        (value && typeof value === "object"
          ? "rows" in value && Array.isArray(value.rows)
            ? value.rows.length
            : Object.values(value)
                .filter(Array.isArray)
                .reduce((n, items) => n + items.length, 0)
          : 1),
      0,
    );
    const source = metadata.connectors.some(
      (id) => this.fabric.descriptor(id).mode === "test",
    )
      ? "test_connector"
      : metadata.connectors.some(
            (id) =>
              this.fabric.descriptor(id).mode === "live" &&
              id !== "notifications",
          )
        ? "authorized_history"
        : "simulation";
    checks.push({
      name: "Read-only reality replay",
      passed: true,
      details: `${output.operations.length} proposed operations; zero external writes`,
    });
    const id =
      parent?.id ??
      (
        draft.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "tool"
      ).slice(0, 48) +
        "-" +
        digest(goal).slice(0, 8);
    onValidated?.();
    return this.store.transaction((state) => {
      const product = (state.product ??= emptyProductState());
      const history = product.programs.filter((p) => p.id === id);
      const major = parent ? Number(parent.version.split(".")[0]) : 1;
      const minor = history.length
        ? Math.max(...history.map((p) => Number(p.version.split(".")[1]))) + 1
        : 0;
      const tool = programSchema.parse({
        ...draft,
        ...metadata,
        id,
        version: `${major}.${minor}.0`,
        ...(parent ? { parentHash: parent.hash } : {}),
        provenance,
        hash: "pending",
        goal,
        status: "review",
        createdAt: now,
        grants: [],
        programState: {},
        usage,
        evidence: {
          checks,
          passed: true,
          compileMs,
          sandboxMs,
          sourceHash: digest(draft.source),
          replay: {
            source,
            observations: observationsCount,
            proposedOperations: output.operations.length,
            externalWrites: 0,
            summary: output.result.summary,
            at: now,
          },
        },
      });
      tool.hash = programHash(tool);
      product.programs.push(tool);
      return tool;
    });
  }
  async approve(id: string, hash: string, permissions: string[]) {
    await this.fabric.discover();
    const proposal = (await this.product()).programs.find(
      (program) => program.id === id && program.hash === hash,
    );
    if (
      proposal?.actions.some((action) => action.startsWith("calendar.")) &&
      !this.fabric.descriptor("calendar").constraints.calendarWritesConsented
    )
      throw new Error(
        "Google Calendar editing needs additional consent. Reconnect Google, then recheck this tool before approving it.",
      );
    return this.store.transaction((state) => {
      const product = (state.product ??= emptyProductState());
      const tool = product.programs.find(
        (p) => p.id === id && p.hash === hash && p.status === "review",
      );
      if (!tool || !tool.evidence.passed)
        throw new Error("Choose the exact tested proposal before approving");
      this.assertHash(tool);
      this.assertBindings(tool);
      if (
        JSON.stringify([...permissions].sort()) !==
        JSON.stringify(tool.permissions)
      )
        throw new Error(
          "Approval must match exactly the displayed permission set",
        );
      for (const old of product.programs.filter(
        (p) =>
          p.id === id &&
          p.hash !== hash &&
          !["review", "rejected", "blocked", "revoked"].includes(p.status),
      )) {
        old.status = "superseded";
        old.grants = [];
      }
      tool.grants = [...tool.permissions];
      tool.status = "ready";
      tool.installedAt = new Date().toISOString();
      if ("intervalSeconds" in tool.trigger)
        tool.nextRunAt = new Date(
          Date.now() + tool.trigger.intervalSeconds * 1000,
        ).toISOString();
      product.lastToolId = id;
      return tool;
    });
  }
  async action(
    id: string,
    hash: string,
    action: "pause" | "resume" | "revoke" | "reject",
  ) {
    await this.fabric.discover();
    return this.store.transaction((state) => {
      const product = (state.product ??= emptyProductState());
      const tool = product.programs.find((p) => p.id === id && p.hash === hash);
      if (!tool) throw new Error("Tool version not found");
      if (action === "reject") {
        if (tool.status !== "review")
          throw new Error("Only a pending proposal can be rejected");
        tool.status = "rejected";
        tool.grants = [];
      }
      if (action === "pause") {
        this.authority(product, id, hash);
        tool.status = "paused";
      }
      if (action === "resume") {
        if (tool.status !== "paused")
          throw new Error("Only a paused tool can resume");
        this.assertHash(tool);
        this.assertBindings(tool);
        if (tool.permissions.some((p) => !tool.grants.includes(p)))
          throw new Error("This tool needs approval again");
        tool.status = "ready";
      }
      if (action === "revoke") {
        tool.status = "revoked";
        tool.grants = [];
        tool.nextRunAt = undefined;
      }
      return tool;
    });
  }
  async rollback(id: string, hash: string) {
    await this.fabric.discover();
    return this.store.transaction((state) => {
      const product = (state.product ??= emptyProductState());
      const tool = product.programs.find(
        (p) => p.id === id && p.hash === hash && p.installedAt,
      );
      if (!tool || tool.status === "revoked")
        throw new Error(
          "Only a previously installed, unrevoked version can be reviewed for rollback",
        );
      this.assertHash(tool);
      this.assertBindings(tool);
      tool.status = "review";
      tool.grants = [];
      return tool;
    });
  }
  async recheck(id: string, hash: string) {
    await this.fabric.discover();
    const original = (await this.product()).programs.find(
      (program) => program.id === id && program.hash === hash,
    );
    if (
      !original ||
      ["revoked", "rejected", "blocked"].includes(original.status)
    )
      throw new Error("Choose an intact unrevoked tool to recheck");
    this.assertHash(original);
    const build: Build = { id: randomUUID(), status: "building", stages: [] };
    this.builds.set(build.id, build);
    const {
      name,
      description,
      source,
      reads,
      actions,
      trigger,
      tests,
      postconditions,
      representation,
    } = original;
    try {
      const tool = await this.stageProgram(
        original.goal,
        {
          name,
          description,
          source,
          reads,
          actions,
          trigger,
          tests,
          ...(postconditions !== undefined ? { postconditions } : {}),
          ...(representation !== undefined ? { representation } : {}),
        },
        {
          ...original.usage,
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          ...(original.usage.stageTimings ? { stageTimings: {} } : {}),
        },
        build,
        original,
      );
      build.status = "ready";
      await this.conversation(
        "forge",
        `${tool.name} was rechecked against the current connection. Approve its new exact binding before running it.`,
        tool.id,
      );
      return tool;
    } catch (error) {
      build.status = "failed";
      throw error;
    }
  }
  async run(
    id: string,
    eventId: string = randomUUID(),
    rawInput: Record<string, unknown> = {},
    now = new Date().toISOString(),
  ): Promise<ProgramRun> {
    await this.fabric.discover();
    const product = await this.product();
    const tool = this.authority(product, id);
    const planId = digest({ id, hash: tool.hash, eventId });
    const started = performance.now();
    const previous =
      product.executionPlans[planId]?.run ??
      product.runs.find(
        (r) =>
          r.toolId === id &&
          r.eventId === eventId &&
          r.hash === tool.hash &&
          r.status === "done",
      );
    if (previous)
      return {
        ...previous,
        status: "ignored",
        summary:
          "This event was already handled; no duplicate changes were made",
        receipts: previous.receipts.map((r) => ({
          ...r,
          status: "deduplicated",
        })),
        verification: previous.verification ?? {
          status: "unverified",
          checks: [
            {
              name: "Historical execution",
              status: "unverified",
              details:
                "Historical execution has no recorded goal postcondition verification",
            },
          ],
          durationMs: 0,
        },
      };
    const receipts: Receipt[] = [];
    const effects: CommittedEffect[] = [];
    let verification: RunVerification | undefined;
    const details: string[] = [];
    const mode = tool.connectors.some(
      (connector) => this.fabric.descriptor(connector).mode === "test",
    )
      ? "test"
      : tool.connectors.some(
            (connector) => this.fabric.descriptor(connector).mode === "live",
          )
        ? "live"
        : "simulation";
    let summary = "No changes made";
    try {
      const observations = await this.observe(tool, eventId, now, tool);
      const input = programInputSchema.parse({
        now,
        input: {
          ...rawInput,
          timeZone: process.env.FORGE_TIME_ZONE ?? "America/Toronto",
          localHour: Number(
            new Intl.DateTimeFormat("en-CA", {
              timeZone: process.env.FORGE_TIME_ZONE ?? "America/Toronto",
              hour: "numeric",
              hourCycle: "h23",
            }).format(new Date(now)),
          ),
        },
        observations,
        state: tool.programState,
      });
      let output = product.executionPlans[planId]?.output;
      if (!output)
        output = await runProgramExecutable(
          tool.source,
          input,
          this.fabric.types(tool),
          this.sandboxMode,
        );
      await this.validateOutput(tool, output, input, eventId);
      output = await this.store.transaction((state) => {
        const persisted = state.product!;
        this.authority(persisted, id, tool.hash);
        if (persisted.executionPlans[planId])
          return persisted.executionPlans[planId].output;
        if (Object.keys(persisted.executionPlans).length >= 500)
          throw new Error(
            "Execution history reached its 500-event capacity; inspect local storage before admitting new events",
          );
        persisted.executionPlans[planId] = { output: output!, createdAt: now };
        return output!;
      });
      for (let index = 0; index < output.operations.length; index++) {
        const action = output.operations[index];
        const operation = this.fabric.operation(action.operation);
        const connector = this.fabric.descriptor(operation.connector);
        const key = digest({
          hash: tool.hash,
          bindings: tool.bindings,
          eventId,
          index,
          action,
        });
        const reservation = await this.store.transaction((state) => {
          const product = state.product!;
          this.authority(product, id, tool.hash);
          const previous = product.outbox[key];
          if (previous?.status === "committed") return previous.receipt!;
          if (previous) {
            previous.status = "uncertain";
            return "uncertain" as const;
          }
          if (Object.keys(product.outbox).length >= 10000)
            throw new Error(
              "Write history reached its capacity; inspect local storage before admitting new changes",
            );
          product.outbox[key] = {
            status: "pending",
            at: new Date().toISOString(),
          };
          return undefined;
        });
        if (reservation === "uncertain")
          throw new Error(
            "A previous write has an uncertain outcome; inspect it before retrying",
          );
        if (reservation) {
          const receipt = { ...reservation, status: "deduplicated" as const };
          receipts.push(receipt);
          effects.push({ key, action, receipt });
          continue;
        }
        try {
          const receipt = await this.store.transaction(async (state) => {
            const product = state.product!;
            this.authority(product, id, tool.hash);
            const response = await this.fabric.invoke(
              action.operation,
              action.arguments,
              {
                key,
                mode: "live",
                now,
                observations,
                workspace: state.product!.workspace,
              },
            );
            const receipt: Receipt = {
              connector: operation.connector,
              operation: action.operation,
              target: response.target ?? operation.name,
              responseId: response.responseId,
              at: new Date().toISOString(),
              status: "committed",
              mode: connector.mode,
            };
            product.outbox[key] = {
              status: "committed",
              at: receipt.at,
              receipt,
            };
            return receipt;
          });
          receipts.push(receipt);
          effects.push({ key, action, receipt });
          if (
            action.operation === "notification.emit" &&
            typeof action.arguments.message === "string"
          )
            details.push(action.arguments.message.slice(0, 300));
        } catch (error) {
          await this.store.transaction((state) => {
            const entry = state.product?.outbox[key];
            if (!entry || entry.status === "committed") return;
            if (
              error instanceof ConnectorHttpError &&
              [400, 401, 403, 404, 409, 412, 429].includes(error.status)
            )
              delete state.product!.outbox[key];
            else entry.status = "uncertain";
          });
          throw error;
        }
      }
      verification = await verifyCommittedRun({
        draft: tool,
        effects,
        fabric: this.fabric,
        now,
        observations,
        assertAuthority: async () => {
          this.authority(await this.product(), id, tool.hash);
        },
      });
      if (verification.status === "failed")
        throw new Error(
          "Committed state did not satisfy the required verification; inspect receipts before retrying",
        );
      summary = receipts.length
        ? this.outcomeSummary(receipts)
        : "No changes needed";
      if (!receipts.length) details.push(output.result.summary);
      if (verification.status === "unverified")
        details.push(
          "Execution completed; the declared mission outcome has not been independently verified.",
        );
      details.push(...output.result.details);
      const run: ProgramRun = {
        id: randomUUID(),
        toolId: id,
        version: tool.version,
        hash: tool.hash,
        eventId,
        at: now,
        durationMs: performance.now() - started,
        status: "done",
        summary,
        details: details.slice(0, 12),
        receipts,
        mode,
        verification,
      };
      await this.store.transaction((state) => {
        const product = state.product!;
        const current = this.authority(product, id, tool.hash);
        current.programState = output.state;
        current.lastRunAt = now;
        product.executionPlans[planId].run = run;
        product.runs.push(run);
        product.runs = product.runs.slice(-1000);
      });
      return run;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The run stopped; inspect its receipts before retrying";
      const run: ProgramRun = {
        id: randomUUID(),
        toolId: id,
        version: tool.version,
        hash: tool.hash,
        eventId,
        at: now,
        durationMs: performance.now() - started,
        status: "failed",
        summary: receipts.length
          ? "The run stopped after some changes"
          : "The run stopped before completion",
        details,
        receipts,
        mode,
        error: message,
        verification: verification ?? {
          status: "unverified",
          checks: [
            {
              name: "Committed outcome",
              status: "unverified",
              details:
                "Execution stopped before its outcome verification completed",
            },
          ],
          durationMs: 0,
        },
      };
      await this.store.transaction((state) => {
        const product = (state.product ??= emptyProductState());
        product.runs.push(run);
        product.runs = product.runs.slice(-1000);
      });
      return run;
    }
  }
  private outcomeSummary(receipts: Receipt[]) {
    const counts = new Map<string, number>();
    for (const receipt of receipts)
      if (receipt.status === "committed")
        counts.set(receipt.operation, (counts.get(receipt.operation) ?? 0) + 1);
    const results = [...counts].map(([operation, count]) =>
      operation === "calendar.update"
        ? `Updated ${count} Calendar event${count === 1 ? "" : "s"}`
        : operation === "calendar.create"
          ? `Created ${count} Calendar event${count === 1 ? "" : "s"}`
          : operation === "notification.emit"
            ? `Recorded ${count} notification${count === 1 ? "" : "s"}`
            : operation === "workspace.save"
              ? "Created " +
                receipts
                  .filter(
                    (receipt) =>
                      receipt.operation === operation &&
                      receipt.status === "committed",
                  )
                  .map((receipt) => receipt.target)
                  .join(", ")
              : `${this.fabric.operation(operation).name}: ${count} completed`,
    );
    return (
      results.join(" · ").slice(0, 300) ||
      "Previously completed changes were preserved"
    );
  }
  // This is an owner-authenticated local delivery surface. It does not claim a
  // provider webhook subscription; remote deliveries need an authorized relay.
  async deliverEvent(
    id: string,
    connector: string,
    event: string,
    externalId: string,
    input: Record<string, unknown> = {},
    now = new Date().toISOString(),
    recovering = false,
  ) {
    z.string().min(1).max(200).parse(externalId);
    boundJson(input, 32768);
    await this.fabric.discover();
    const tool = this.authority(await this.product(), id);
    if (
      tool.trigger.kind !== "connector_event" ||
      tool.trigger.connector !== connector ||
      tool.trigger.event !== event
    )
      throw new Error("This event is not bound to the approved tool trigger");
    const eventId = recovering
      ? externalId
      : "connector:" +
        digest({ id, hash: tool.hash, connector, event, externalId });
    const admitted = await this.store.transaction((state) => {
      const product = state.product!;
      this.authority(product, id, tool.hash);
      const previous = product.triggerEvents[eventId];
      if (previous?.hash && previous.hash !== tool.hash)
        throw new Error(
          "The pending event belongs to a different tool version",
        );
      if (previous?.status === "failed")
        throw new Error(
          "This event failed; inspect its receipts before an explicit run retry",
        );
      if (previous) return previous;
      if (Object.keys(product.triggerEvents).length >= 10000)
        throw new Error(
          "Trigger history reached its capacity; inspect server storage before admitting more events",
        );
      const delivery = {
        toolId: id,
        hash: tool.hash,
        status: "pending" as const,
        at: now,
        input,
      };
      product.triggerEvents[eventId] = delivery;
      return delivery;
    });
    const run = await this.run(id, eventId, admitted.input ?? input, now);
    await this.store.transaction((state) => {
      state.product!.triggerEvents[eventId] = {
        toolId: id,
        hash: tool.hash,
        status: run.status === "failed" ? "failed" : "done",
        at: now,
        latencyMs: run.durationMs,
      };
    });
    return run;
  }
  async tick(now = new Date().toISOString()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const product = await this.product();
      for (const [eventId, pending] of Object.entries(product.triggerEvents)) {
        const tool = product.programs.find(
          (p) =>
            p.id === pending.toolId &&
            p.hash === pending.hash &&
            p.status === "ready" &&
            p.trigger.kind === "connector_event",
        );
        if (
          pending.status === "pending" &&
          tool &&
          tool.trigger.kind === "connector_event"
        )
          await this.deliverEvent(
            tool.id,
            tool.trigger.connector,
            tool.trigger.event,
            eventId,
            pending.input ?? {},
            now,
            true,
          );
      }
      for (const tool of product.programs.filter(
        (p) =>
          p.status === "ready" &&
          "intervalSeconds" in p.trigger &&
          p.nextRunAt &&
          p.nextRunAt <= now,
      )) {
        const eventId =
          "scheduled:" + tool.id + ":" + tool.hash + ":" + tool.nextRunAt;
        const reserved = await this.store.transaction((state) => {
          const product = state.product!;
          const current = product.programs.find(
            (p) => p.hash === tool.hash && p.status === "ready",
          );
          if (
            !current ||
            ["done", "failed"].includes(
              product.triggerEvents[eventId]?.status ?? "",
            )
          )
            return false;
          // A durable pending event is recovered after restart. Committed outbox
          // entries deduplicate; uncertain entries stop rather than repeat writes.
          if (
            Object.keys(product.triggerEvents).length >= 10000 &&
            !product.triggerEvents[eventId]
          )
            throw new Error(
              "Trigger history reached its capacity; inspect server storage before admitting more events",
            );
          product.triggerEvents[eventId] = {
            toolId: tool.id,
            hash: tool.hash,
            status: "pending",
            at: now,
          };
          return true;
        });
        if (!reserved) continue;
        let run: ProgramRun | undefined;
        try {
          run = await this.run(tool.id, eventId, {}, now);
        } catch {
          /* Reconnection or revocation can happen before admission. Persist failed delivery below. */
        }
        await this.store.transaction((state) => {
          const product = state.product!;
          product.triggerEvents[eventId] = {
            toolId: tool.id,
            hash: tool.hash,
            status: !run || run.status === "failed" ? "failed" : "done",
            at: now,
            latencyMs: run?.durationMs,
          };
          const current = product.programs.find(
            (p) => p.hash === tool.hash && p.status === "ready",
          );
          if (current && "intervalSeconds" in current.trigger)
            current.nextRunAt = new Date(
              Date.parse(now) + current.trigger.intervalSeconds * 1000,
            ).toISOString();
          product.scheduler.lastTickAt = now;
        });
      }
    } finally {
      this.ticking = false;
    }
  }
  startScheduler() {
    if (!this.timer) {
      this.timer = setInterval(() => {
        void this.tick().catch(() => {
          /* Explicit Activity and connector requests surface failures; no private background content is logged. */
        });
      }, 5000);
      this.timer.unref();
    }
  }
  stopScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
