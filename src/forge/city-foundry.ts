import { randomUUID } from "node:crypto";
import { MemoryStateStore } from "./store";
import type { ForgeService } from "./service";
import type { Sandbox } from "./sandbox";
import { digest } from "./hash";
import { compileExecutable } from "./executable";
import { TwinEnvironmentProvider } from "./environment";
import { advanceCity, cityEvent, controlCity } from "./city-engine";
import {
  cityCapability,
  candidateFrom,
  evaluateFutures,
  pairedSeeds,
} from "./futures";
import {
  DevelopmentEnvironmentModel,
  developmentGoal,
  environmentResponseSchema,
  type EnvironmentModel,
} from "./city-model";
import type { CityContest, SimulationControl } from "./city-contracts";
import type { Capability } from "./spec";
import { ControllerModel } from "./controller-model";
import { controllerSource } from "./city-controllers";
import { programMemory, metaDecision } from "./program-memory";
export class CityFoundry {
  readonly provider: TwinEnvironmentProvider;
  private running = false;
  private ticking = false;
  constructor(
    private service: ForgeService,
    private sandbox: Sandbox,
    private model: EnvironmentModel = new DevelopmentEnvironmentModel(),
  ) {
    this.provider = new TwinEnvironmentProvider(service.store);
  }
  async request(
    request: string,
    previousId?: string,
    controller?: "pressure" | "optimizer" | "rl" | "hybrid" | "placement",
  ) {
    if (this.running) throw new Error("A City compilation is already running");
    this.running = true;
    try {
      if (request.length < 5 || request.length > 4000)
        throw new Error("Goal must contain 5 to 4000 characters");
      const snapshot = await this.provider.observe();
      const state = await this.service.store.read();
      const previous = previousId
        ? state.releases.find(
            (r) =>
              r.definition.id === previousId &&
              r.status === "installed" &&
              r.definition.executable?.interface === "city/v1",
          )?.definition
        : undefined;
      if (previousId && !previous)
        throw new Error("Requested installed City parent not found");
      const contest: CityContest = {
        id: randomUUID(),
        request,
        at: new Date().toISOString(),
        status: "observing",
        interpretation:
          "Observing authoritative City resources before interpretation",
        snapshotHash: digest(snapshot),
        environmentId: snapshot.id,
        resolution: previous ? "EXTEND" : "SYNTHESIZE",
        previousId,
        candidates: [],
        seeds: pairedSeeds(),
        baseline: [],
        stages: [
          {
            name: "Observed current environment",
            at: new Date().toISOString(),
          },
        ],
      };
      await this.service.store.transaction((s) => {
        s.contests = [...(s.contests ?? []).slice(-7), contest];
      });
      void this.compile(
        contest,
        snapshot,
        previous,
        controller ? new ControllerModel(controller) : this.model,
      ).finally(() => {
        this.running = false;
      });
      return { contestId: contest.id, status: contest.status };
    } catch (error) {
      this.running = false;
      throw error;
    }
  }
  private async compile(
    contest: CityContest,
    snapshot: Awaited<ReturnType<TwinEnvironmentProvider["observe"]>>,
    previous?: Capability,
    compiler: EnvironmentModel = this.model,
  ) {
    const persist = async () => {
      await this.service.store.transaction((s) => {
        const index = s.contests?.findIndex((c) => c.id === contest.id) ?? -1;
        if (index < 0)
          throw new Error("Futures evidence was removed while compiling");
        s.contests![index] = structuredClone(contest);
      });
    };
    const stage = async (name: string) => {
      contest.stages.push({ name, at: new Date().toISOString() });
      await persist();
    };
    try {
      contest.status = "generating";
      await stage("Interpreting goal and generating three source algorithms");
      let generation = await compiler.generate(
        contest.request,
        this.provider,
        snapshot,
        previous,
      );
      generation.value = environmentResponseSchema.parse(generation.value);
      contest.providerEvidence = [generation.evidence];
      if (generation.value.kind !== "goal") {
        contest.interpretation = generation.value.interpretation;
        if (generation.value.kind === "control") {
          // This is an explicit owner simulation request, not generated runtime authority.
          await this.service.store.transaction((s) => {
            if (!s.city || s.city.id !== snapshot.id)
              throw new Error("Environment binding changed");
            for (const change of generation.value.kind === "control"
              ? generation.value.changes
              : [])
              controlCity(s.city, change);
          });
        }
        contest.status = "reused";
        await stage("Interpretation completed; no capability installed");
        return;
      }
      contest.goal = generation.value.contract;
      contest.interpretation = contest.goal.interpretation;
      const currentState = await this.service.store.read();
      const remembered = programMemory(
        snapshot,
        contest.goal,
        currentState.releases,
        currentState.contests ?? [],
      );
      if (remembered.length)
        await stage(
          "Retrieved " +
            remembered.length +
            " installed programs from this environment; reuse never changes grants",
        );
      const library = (await this.service.store.read()).releases.filter(
        (r) =>
          r.status === "installed" &&
          r.definition.executable?.interface === "city/v1",
      );
      contest.reuseIds =
        generation.value.reuseIds ?? (previous ? [previous.id] : []);
      if (
        contest.reuseIds.some(
          (id) => !library.some((r) => r.definition.id === id),
        )
      )
        throw new Error(
          "Model referenced unavailable software; cannot fabricate reuse",
        );
      contest.resolution =
        generation.value.resolution ?? (previous ? "EXTEND" : "SYNTHESIZE");
      if (contest.resolution === "EXACT_MATCH") {
        const existing = library.find(
          (r) => r.definition.id === contest.reuseIds?.[0],
        );
        if (
          !existing ||
          digest(existing.definition.goal) !== digest(contest.goal) ||
          snapshot.deployment?.digest !== existing.digest ||
          snapshot.deployment.degraded
        )
          throw new Error(
            "Exact reuse requires the same GoalContract, installed artifact and unchanged assumptions",
          );
        contest.status = "reused";
        contest.releaseDigest = existing.digest;
        await stage(
          "Exact installed artifact reused; no source, permissions or authority changed",
        );
        return;
      }
      if (contest.resolution === "COMPOSE" && !contest.reuseIds.length)
        throw new Error(
          "Composition requires discovered installed software references",
        );
      if (contest.resolution === "EXTEND") {
        previous ??= library.find(
          (r) => r.definition.id === contest.reuseIds?.[0],
        )?.definition;
        if (!previous)
          throw new Error("Extension requires an installed compatible parent");
        contest.previousId = previous.id;
      }
      contest.candidates = generation.value.candidates.map((c) =>
        candidateFrom(
          c.source,
          c.name,
          generation.evidence,
          cityCapability(
            contest.goal!,
            c.source,
            c.name,
            contest.resolution === "EXTEND" ? previous : undefined,
          ),
        ),
      );
      if (
        !previous &&
        contest.goal.objectives.every((o) => o.metric === "congestion") &&
        contest.goal.actions.includes("signal.set") &&
        !(compiler instanceof ControllerModel)
      ) {
        const source = controllerSource("hybrid");
        contest.candidates.push(
          candidateFrom(
            source,
            "Learned bounded traffic comparison",
            {
              provider: "HOST CONTROLLER",
              model: "signal-dqn-1 + exact switch allocation",
              requestIds: [],
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
            },
            cityCapability(contest.goal, source, "Learned traffic comparison"),
          ),
        );
      }
      await stage(
        "Strategy: " +
          metaDecision({
            exact: false,
            parent: !!previous,
            compose: contest.resolution === "COMPOSE",
            lowConfidence: false,
            unsafeObserved: false,
            controller:
              compiler instanceof ControllerModel
                ? "LEARNED_OR_OPTIMIZED"
                : undefined,
          }).action,
      );
      // One bounded source-repair request. Preserve rejected hash and failure evidence.
      const compileFailures: { id: string; hash: string; failure: string }[] =
        [];
      for (const c of contest.candidates) {
        try {
          compileExecutable(c.source, "city/v1");
          const store = new MemoryStateStore();
          await store.transaction((s) => {
            s.city = structuredClone(snapshot);
            delete s.city.deployment;
          });
          const provider = new TwinEnvironmentProvider(store);
          const cap = cityCapability(contest.goal, c.source, c.name, previous);
          const run = await this.sandbox.run(
            cap,
            { id: randomUUID(), type: cap.trigger, payload: {} },
            store,
            undefined,
            {
              kind: "city",
              mode: "FUTURES",
              provider,
              goal: contest.goal,
              binding: snapshot.id,
            },
          );
          if (run.status !== "success")
            throw new Error(run.error ?? "Sandbox preflight failed");
        } catch (e) {
          const failure = (
            e instanceof Error ? e.message : "Compile failure"
          ).slice(0, 600);
          c.attempts[0].failure = failure;
          compileFailures.push({ id: c.id, hash: c.hash, failure });
        }
      }
      if (compileFailures.length) {
        await stage("One bounded repair: compiler failures recorded");
        generation = await compiler.generate(
          contest.request,
          this.provider,
          snapshot,
          previous,
          JSON.stringify({
            contract: contest.goal,
            candidates: contest.candidates.map((c) => ({
              source: c.source,
              name: c.name,
            })),
            compileFailures,
            instruction:
              "Repair invalid sources. Preserve the accepted GoalContract; do not weaken constraints. Return kind goal and exactly three complete sources.",
          }),
        );
        generation.value = environmentResponseSchema.parse(generation.value);
        contest.providerEvidence.push(generation.evidence);
        if (generation.value.kind !== "goal")
          throw new Error(
            "Bounded repair did not return source candidates; admission refused",
          );
        // Original owner interpretation remains immutable. A model's repair contract
        // cannot relax hard constraints or grant actuators; all code is evaluated
        // against contest.goal and its exact manifest, regardless of repair prose.
        if (digest(generation.value.contract) !== digest(contest.goal))
          await stage(
            "Discarded repair contract; original GoalContract and authority remain unchanged",
          );
        for (let i = 0; i < contest.candidates.length; i++) {
          const candidate = contest.candidates[i];
          if (!candidate.attempts[0].failure) continue;
          const repaired = generation.value.candidates[i];
          if (!repaired) continue; // Host comparison has no corresponding model repair proposal.
          candidate.source = repaired.source;
          candidate.hash = digest(repaired.source);
          candidate.attempts.push({ attempt: 2, hash: candidate.hash });
          candidate.requestIds.push(...generation.evidence.requestIds);
          candidate.durationMs += generation.evidence.durationMs;
          candidate.inputTokens += generation.evidence.inputTokens;
          candidate.outputTokens += generation.evidence.outputTokens;
        }
      }
      if (previous?.executable)
        contest.candidates.push(
          candidateFrom(
            previous.executable.source,
            "Installed v" + previous.version,
            {
              provider: "Installed artifact",
              model: "No new model request",
              requestIds: [],
              durationMs: 0,
              inputTokens: 0,
              outputTokens: 0,
            },
            previous,
          ),
        );
      contest.status = "testing";
      await stage("Strict schema, TypeScript and source uniqueness");
      await evaluateFutures(contest, snapshot, this.sandbox, persist, previous);
      await stage("Safety-first ranking completed; validating winning release");
      const winner = contest.candidates.find((c) => c.id === contest.winner)!;
      const definition = cityCapability(
        contest.goal,
        winner.source,
        winner.name,
        contest.resolution === "EXTEND" ? previous : undefined,
      );
      if (previous && contest.resolution === "EXTEND") {
        const known = (await this.service.store.read()).releases.filter(
          (r) => r.definition.id === definition.id,
        );
        const major = Number(previous.version.split(".")[0]);
        const minor =
          Math.max(
            ...known
              .filter(
                (r) => Number(r.definition.version.split(".")[0]) === major,
              )
              .map((r) => Number(r.definition.version.split(".")[1])),
          ) + 1;
        definition.version = major + "." + minor + ".0";
      }
      const release = await this.service.stageEnvironment(definition, contest, {
        model: winner.model,
        inputTokens: contest.providerEvidence.reduce(
          (sum, e) => sum + e.inputTokens,
          0,
        ),
        outputTokens: contest.providerEvidence.reduce(
          (sum, e) => sum + e.outputTokens,
          0,
        ),
        estimatedCost: null,
        requestIds: contest.providerEvidence.flatMap((e) => e.requestIds),
      });
      if (!release.report.passed)
        throw new Error(
          "Winning algorithm failed local release validation; nothing installed",
        );
      contest.releaseDigest = release.digest;
      contest.status = "review";
      await stage(
        "Awaiting owner approval; evaluated forks have no current City authority",
      );
    } catch (e) {
      contest.status = "failed";
      contest.error = (
        e instanceof Error ? e.message : "City compilation failed"
      )
        .replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, "[redacted]")
        .slice(0, 1000);
      try {
        await stage("Admission stopped; no new authority");
      } catch {
        /* Removed evidence cannot confer authority. */
      }
    }
  }
  async approve(contestId: string, expectedDigest: string) {
    const state = await this.service.store.read();
    const contest = state.contests?.find((c) => c.id === contestId);
    const release = state.releases.find(
      (r) => r.digest === expectedDigest && r.futures?.contestId === contestId,
    );
    if (
      !contest ||
      !release ||
      contest.releaseDigest !== expectedDigest ||
      !["review", "installed"].includes(contest.status)
    )
      throw new Error("Exact reviewed Futures release required");
    await this.service.approve(
      release.definition.id,
      release.definition.version,
      expectedDigest,
    );
    await this.service.store.transaction((s) => {
      if (!s.city || s.city.id !== contest.environmentId)
        throw new Error("Environment changed; approval cannot bind");
      const current = s.releases.find(
        (r) => r.digest === expectedDigest && r.status === "installed",
      );
      if (
        !current?.approvedAt ||
        s.live?.trust[expectedDigest]?.current === "REVOKED"
      )
        throw new Error("Approved authority changed");
      s.city.deployment = {
        id: current.definition.id,
        version: current.definition.version,
        digest: expectedDigest,
        binding: s.city.id,
        nextAt: s.city.seconds,
        baselineRevision: s.city.revision,
        degraded: false,
        degradation: "",
        approvedAt: current.approvedAt,
      };
      s.contests!.find((c) => c.id === contestId)!.status = "installed";
      s.live?.trust[expectedDigest]?.stages.push({
        stage: "DIGITAL_TWIN_APPROVED",
        at: current.approvedAt,
      });
      cityEvent(
        s.city,
        "Owner approved " +
          current.definition.name +
          " v" +
          current.definition.version +
          " for current City revision " +
          s.city.revision +
          "; no future snapshot restored",
        "human",
      );
    });
    return this.run();
  }
  async run() {
    const state = await this.service.store.read();
    const deployment = state.city?.deployment;
    if (!deployment) throw new Error("No approved City deployment");
    return this.service.trigger(deployment.id, {
      id: randomUUID(),
      type: "manual",
      payload: {},
    });
  }
  async control(change: SimulationControl) {
    await this.provider.observe();
    await this.service.store.transaction((s) => {
      controlCity(s.city!, change);
    });
    const city = await this.provider.observe();
    this.provider.notify(city);
    return city;
  }
  async attack(text: string) {
    await this.control({ operation: "sensor.inject", text });
    const city = await this.provider.observe();
    const source =
      'function execute(input: ModuleInput): ModuleOutput { const hospital = input.environment.buildings.find(b => b.kind === "hospital"); return { actions: hospital ? [{ operation: "grid.shed", buildingId: hospital.id, power: 0 }] : [] }; }';
    const cap = cityCapability(
      developmentGoal,
      source,
      "Unapproved adversarial probe",
    );
    const fork = new MemoryStateStore();
    await fork.transaction((s) => {
      s.city = structuredClone(city);
      delete s.city.deployment;
    });
    const provider = new TwinEnvironmentProvider(fork);
    const forkBefore = digest((await fork.read()).city);
    const result = await this.sandbox.run(
      cap,
      { id: randomUUID(), type: "manual", payload: {} },
      fork,
      undefined,
      {
        kind: "city",
        mode: "FUTURES",
        provider,
        goal: developmentGoal,
        binding: city.id,
      },
    );
    if (
      result.status !== "failed" ||
      !result.error?.includes("critical infrastructure power floor")
    )
      throw new Error("Red-team probe did not reach the expected safety gate");
    if (digest((await fork.read()).city) !== forkBefore)
      throw new Error("Adversarial probe changed its isolated City fork");
    result.outcome.securityProbe = true;
    result.outcome.probeSourceHash = digest(source);
    result.outcome.admitted = false;
    result.outcome.currentCityUnchanged = true;
    result.outcome.isolatedForkUnchanged = true;
    result.outcome.currentSimulationMayAdvanceIndependently = true;
    await this.service.store.transaction((s) => {
      s.executions.push(result);
      cityEvent(
        s.city!,
        "BLOCKED: adversarial executable proposed hospital shutdown. Broker rejected critical infrastructure power floor; current City unchanged.",
        "simulation",
      );
    });
    return result;
  }
  async reviewImported(expectedDigest: string) {
    if (this.running) throw new Error("A City evaluation is already running");
    this.running = true;
    try {
      const state = await this.service.store.read();
      const release = state.releases.find(
        (r) =>
          r.digest === expectedDigest &&
          r.definition.executable?.interface === "city/v1",
      );
      if (
        !release?.report.passed ||
        !state.live?.trust[expectedDigest]?.imported ||
        release.status !== "review"
      )
        throw new Error("Intact passing imported City software required");
      const snapshot = await this.provider.observe();
      const candidate = candidateFrom(
        release.definition.executable!.source,
        release.definition.name,
        {
          provider: "Imported signed software",
          model: release.usage.model,
          requestIds: [],
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
        release.definition,
      );
      const contest: CityContest = {
        id: randomUUID(),
        request: "Independent local Futures for imported software",
        at: new Date().toISOString(),
        status: "testing",
        interpretation:
          "Signature conveys software identity, never authority. Running the unchanged imported algorithm against current local stochastic Futures.",
        goal: release.definition.goal!,
        snapshotHash: digest(snapshot),
        environmentId: snapshot.id,
        resolution: "SYNTHESIZE",
        candidates: [candidate],
        seeds: pairedSeeds(),
        baseline: [],
        stages: [
          {
            name: "Imported artifact has zero local authority",
            at: new Date().toISOString(),
          },
        ],
      };
      await this.service.store.transaction((s) => {
        s.contests = [...(s.contests ?? []).slice(-7), contest];
      });
      const persist = async () => {
        await this.service.store.transaction((s) => {
          const index = s.contests!.findIndex((c) => c.id === contest.id);
          if (index < 0) throw new Error("Local evidence removed");
          s.contests![index] = structuredClone(contest);
        });
      };
      void (async () => {
        try {
          await evaluateFutures(contest, snapshot, this.sandbox, persist);
          await this.service.store.transaction((s) => {
            const local = s.releases.find(
              (r) => r.digest === expectedDigest && r.status === "review",
            );
            if (!local || digest(local.definition) !== expectedDigest)
              throw new Error("Imported artifact changed during evaluation");
            local.futures = {
              contestId: contest.id,
              snapshotHash: contest.snapshotHash,
              sourceHash: candidate.hash,
              rolloutCount: candidate.rollouts.length,
              passed: true,
            };
            s.live!.trust[expectedDigest].stages.push({
              stage: "LOCAL_FUTURES_VERIFIED",
              at: new Date().toISOString(),
            });
          });
          contest.releaseDigest = expectedDigest;
          contest.status = "review";
          contest.stages.push({
            name:
              candidate.rollouts.length +
              " local Futures passed; still UNTRUSTED until owner approval",
            at: new Date().toISOString(),
          });
          await persist();
        } catch (e) {
          contest.status = "failed";
          contest.error = (
            e instanceof Error ? e.message : "Import evaluation failed"
          ).slice(0, 1000);
          await persist();
        } finally {
          this.running = false;
        }
      })();
      return { contestId: contest.id };
    } catch (error) {
      this.running = false;
      throw error;
    }
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const before = await this.service.store.read();
      if (!before.city || before.city.paused) return;
      await this.service.store.transaction((s) => {
        if (s.city && !s.city.paused) advanceCity(s.city, 2);
      });
      const city = await this.provider.observe();
      this.provider.notify(city);
      if (city.deployment && city.seconds >= city.deployment.nextAt) {
        await this.service.store.transaction((s) => {
          if (s.city?.deployment)
            s.city.deployment.nextAt = s.city.seconds + 40;
        });
        const run = await this.run();
        if (run.status !== "success")
          await this.service.store.transaction((s) => {
            if (s.city?.deployment) {
              s.city.deployment.degraded = true;
              s.city.deployment.degradation =
                "Current execution blocked: " +
                (run.error ?? "Unknown failure");
            }
          });
      }
    } finally {
      this.ticking = false;
    }
  }
}
