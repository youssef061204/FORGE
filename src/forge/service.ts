import { z } from "zod";
import { compile, bump } from "./compiler";
import { DemoModelProvider, type ModelProvider } from "./models";
import { digest } from "./hash";
import { validateCapability, eventSchema } from "./spec";
import { generatedTestNames, validateRelease } from "./validation";
import {
  semanticDiff,
  type Release,
  type Execution,
  type State,
  type BuildProgress,
} from "./records";
import { type StateStore } from "./store";
import { IsolatedSandbox, type Sandbox } from "./sandbox";
import { postings } from "./fixtures";
import { createWorld, maliciousDelivery, worldOperations } from "./world";
import { PermissionBroker } from "./broker";
import { emptyLive, trustSchema } from "./live-contracts";
import {
  FixtureConnector,
  GoogleConnection,
  type Connector,
} from "./connectors";
import { replayCapability } from "./replay";
import { packageCapsule, signingKey, verifyCapsule } from "./capsule";
import { deriveToolContract } from "./contracts";
import { signWithKms, storeCapsule } from "./aws-artifacts";
import { CityFoundry } from "./city-foundry";
import { type EnvironmentModel } from "./city-model";
import { TwinEnvironmentProvider } from "./environment";
import type { CityContest } from "./city-contracts";
import { GoogleEnvironmentProvider } from "./google-environment";
import { CityLab } from "./city-lab";
import type { ProductRuntime } from "./product/runtime";

export class ForgeService {
  product?: ProductRuntime;
  readonly city: CityFoundry;
  readonly lab: CityLab;
  readonly connectedEnvironment: GoogleEnvironmentProvider;
  private pendingEvents = new Map<string, Promise<Execution>>();
  private builds = new Map<string, BuildProgress>();
  buildProgress(id: string) {
    const progress = this.builds.get(id);
    return progress ? structuredClone(progress) : undefined;
  }
  constructor(
    readonly store: StateStore,
    private model: ModelProvider = new DemoModelProvider(),
    private sandbox: Sandbox = new IsolatedSandbox(),
    readonly google: GoogleConnection = new GoogleConnection(),
    environmentModel?: EnvironmentModel,
  ) {
    this.city = new CityFoundry(this, sandbox, environmentModel);
    this.lab = new CityLab(this, sandbox);
    this.connectedEnvironment = new GoogleEnvironmentProvider(this);
  }
  async stageEnvironment(
    definition: Release["definition"],
    contest: CityContest,
    usage: Release["usage"],
  ) {
    const candidate = contest.candidates.find((c) => c.id === contest.winner);
    if (
      !candidate ||
      candidate.status !== "winner" ||
      candidate.rollouts.length < 20 ||
      candidate.rollouts.length > 40 ||
      candidate.rollouts.some((r, i) => r.seed !== contest.seeds[i]) ||
      candidate.rollouts.some((r) => r.error || r.violations.length) ||
      digest(candidate.source) !== candidate.hash ||
      definition.executable?.source !== candidate.source ||
      digest(definition.goal) !== digest(contest.goal)
    )
      throw new Error("Matching safe Futures evidence required");
    const previous = (await this.store.read()).releases.find(
      (r) => r.definition.id === definition.id && r.status === "installed",
    )?.definition;
    const release = await this.stage(
      definition,
      contest.resolution,
      usage,
      previous,
    );
    await this.store.transaction((s) => {
      const stored = s.releases.find((r) => r.digest === release.digest)!;
      stored.futures = {
        contestId: contest.id,
        snapshotHash: contest.snapshotHash,
        sourceHash: candidate.hash,
        rolloutCount: candidate.rollouts.length,
        passed: true,
      };
      s.live?.trust[release.digest]?.stages.push({
        stage: "FUTURES_VERIFIED",
        at: new Date().toISOString(),
      });
    });
    return (await this.store.read()).releases.find(
      (r) => r.digest === release.digest,
    )!;
  }
  async snapshot() {
    let state = await this.store.read();
    if (state.releases.some((r) => !state.live?.trust[r.digest])) {
      await this.store.transaction((s) => {
        s.live ??= emptyLive();
        for (const r of s.releases)
          if (!s.live.trust[r.digest]) {
            const stages = [{ stage: "GENERATED", at: r.definition.createdAt }];
            if (r.report.passed)
              stages.push(
                ...["SANDBOXED", "TESTED", "SECURITY_VERIFIED"].map(
                  (stage) => ({ stage, at: r.report.completedAt }),
                ),
              );
            if (r.approvedAt)
              stages.push({ stage: "HUMAN_APPROVED", at: r.approvedAt });
            s.live.trust[r.digest] = {
              digest: r.digest,
              current: r.approvedAt
                ? "HUMAN_APPROVED"
                : r.report.passed
                  ? "SECURITY_VERIFIED"
                  : "GENERATED",
              stages,
              grants: [],
              imported: false,
            };
          }
      });
      state = await this.store.read();
    }
    const runs = state.executions.filter((e) => e.status !== "ignored");
    const sorted = runs.map((e) => e.latencyMs).sort((a, b) => a - b);
    return {
      ...state,
      world: state.world ?? createWorld(),
      metrics: {
        executionCount: runs.length,
        successRate: runs.length
          ? Math.round(
              (100 * runs.filter((e) => e.status === "success").length) /
                runs.length,
            )
          : null,
        failures: runs.filter((e) => e.status === "failed").length,
        p95LatencyMs: sorted.length
          ? sorted[Math.ceil(sorted.length * 0.95) - 1]
          : null,
        estimatedCost: runs.reduce((a, e) => a + e.estimatedCost, 0),
        permissionDenials: runs.reduce((a, e) => a + e.permissionDenials, 0),
        repairs: state.audit.filter((a) => a.action === "repair.proposed")
          .length,
        tokens: runs.reduce((a, e) => a + e.tokens, 0),
      },
    };
  }
  async propose(
    request: string,
    buildId = crypto.randomUUID(),
  ): Promise<Release> {
    if (this.builds.has(buildId)) throw new Error("Build ID already used");
    if (this.builds.size >= 16) {
      const completed = [...this.builds].find(
        ([, b]) => b.status !== "building",
      );
      if (!completed) throw new Error("Build capacity reached; retry later");
      this.builds.delete(completed[0]);
    }
    const progress: BuildProgress = {
      id: buildId,
      status: "building",
      stages: [],
    };
    this.builds.set(buildId, progress);
    const observe = (name: string) => {
      const previous = progress.stages.at(-1);
      if (previous)
        previous.durationMs = Date.now() - Date.parse(previous.startedAt);
      progress.stages.push({ name, startedAt: new Date().toISOString() });
    };
    try {
      const release = await this.compileProposal(request, observe, progress);
      observe(
        release.status === "blocked"
          ? "Installation blocked"
          : release.status === "installed"
            ? "Existing capability ready"
            : "Ready for approval",
      );
      progress.stages.at(-1)!.durationMs = 0;
      progress.status = release.status === "blocked" ? "blocked" : "ready";
      return release;
    } catch (error) {
      observe("Build failed");
      progress.stages.at(-1)!.durationMs = 0;
      progress.status = "failed";
      throw error;
    }
  }
  private async compileProposal(
    request: string,
    observe: (stage: string) => void,
    progress: BuildProgress,
  ): Promise<Release> {
    observe("Reading capability registry");
    const state = await this.store.read();
    const installed = state.releases.filter((r) => r.status === "installed");
    const compiled = await compile(
      request,
      installed.map((r) => r.definition),
      this.model,
      observe,
    );
    if (compiled.resolution === "EXACT_MATCH")
      return installed.find((r) => r.definition.id === compiled.definition.id)!;
    // Always allocate above historical versions, including abandoned proposals and rollback histories.
    const history = state.releases.filter(
      (r) => r.definition.id === compiled.definition.id,
    );
    if (
      history.some((r) => r.definition.version === compiled.definition.version)
    ) {
      const highest = history
        .map((r) => r.definition.version)
        .sort(compareVersions)
        .at(-1)!;
      compiled.definition.version = bump(highest, "minor");
    }
    const previous = installed.find(
      (r) => r.definition.id === compiled.definition.id,
    )?.definition;
    const reusedNodes =
      compiled.resolution === "EXTEND" && previous
        ? compiled.definition.nodes
            .filter((n) => previous.nodes.some((p) => digest(n) === digest(p)))
            .map((n) => n.id)
        : compiled.reusedNodes;
    return this.stage(
      compiled.definition,
      compiled.resolution,
      compiled.usage,
      previous,
      {
        primitiveCount: compiled.definition.nodes.length,
        reusedNodes,
        reusedCapabilities: reusedNodes.length
          ? [
              previous?.id ??
                installed.find((r) =>
                  r.definition.nodes.some((n) => reusedNodes.includes(n.id)),
                )?.definition.id ??
                "registry",
            ]
          : [],
        newNodes: compiled.definition.nodes.length - reusedNodes.length,
      },
      observe,
      progress,
    );
  }
  private async stage(
    definition: Release["definition"],
    resolution: Release["resolution"],
    usage: Release["usage"],
    previous?: Release["definition"],
    reuse?: Release["reuse"],
    observe?: (stage: string) => void,
    progress?: BuildProgress,
  ) {
    const cap = validateCapability(definition);
    const report = await validateRelease(cap, this.sandbox, observe);
    observe?.("Persisting validated proposal");
    const release: Release = {
      definition: cap,
      digest: digest(cap),
      status: report.passed ? "review" : "blocked",
      resolution,
      report,
      artifacts: {
        program: JSON.stringify(
          { format: "ForgeSpec/1", definition: cap },
          null,
          2,
        ),
        tests:
          cap.executable?.interface === "city/v1"
            ? report.checks.map((c) => c.name)
            : generatedTestNames,
      },
      reuse,
      diff: semanticDiff(previous, cap),
      usage,
      buildStages: progress
        ? structuredClone(
            progress.stages.filter((stage) => stage.durationMs !== undefined),
          )
        : undefined,
    };
    await this.store.transaction((state) => {
      if (
        state.releases.some(
          (r) =>
            r.definition.id === cap.id && r.definition.version === cap.version,
        )
      )
        throw new Error("Version already exists; retry compilation");
      state.releases.push(release);
      state.live ??= emptyLive();
      state.live.trust[release.digest] = {
        digest: release.digest,
        current: report.passed ? "SECURITY_VERIFIED" : "GENERATED",
        grants: [],
        imported: false,
        stages: [
          { stage: "GENERATED", at: cap.createdAt },
          ...(report.passed
            ? [
                "SANDBOXED",
                "TESTED",
                ...(cap.nodes.some((n) =>
                  worldOperations.includes(
                    n.operation as (typeof worldOperations)[number],
                  ),
                )
                  ? ["SIMULATED"]
                  : []),
                "SECURITY_VERIFIED",
              ].map((stage) => ({ stage, at: report.completedAt }))
            : []),
        ],
      };
      audit(
        state,
        "release.proposed",
        cap.id,
        `${cap.version} ${resolution}; ${report.checks.filter((c) => c.passed).length}/${report.checks.length} executable checks passed`,
      );
    });
    return release;
  }
  async approve(id: string, version: string, expectedDigest: string) {
    const started = performance.now();
    return this.store.transaction((state) => {
      const release = state.releases.find(
        (r) => r.definition.id === id && r.definition.version === version,
      );
      if (release?.status === "installed") {
        assertRelease(release, expectedDigest);
        return release;
      }
      if (!release || release.status !== "review")
        throw new Error("Release is not awaiting approval");
      assertRelease(release, expectedDigest);
      const trust = state.live?.trust[release.digest];
      if (
        release.definition.executable?.interface === "deadline/v1" &&
        (!trust?.replayId ||
          !state.live?.replays.some(
            (r) => r.id === trust.replayId && r.passed && r.mode === "REPLAY",
          ))
      )
        throw new Error("Reality Replay must pass before human approval");
      if (release.definition.executable?.interface === "city/v1") {
        const contest = state.contests?.find(
          (c) => c.id === release.futures?.contestId,
        );
        const candidate = contest?.candidates.find(
          (c) => c.id === contest.winner,
        );
        if (
          !release.futures?.passed ||
          contest?.releaseDigest !== release.digest ||
          candidate?.hash !== digest(release.definition.executable.source) ||
          candidate.status !== "winner" ||
          candidate.rollouts.length < 20 ||
          candidate.rollouts.length > 40 ||
          release.futures.rolloutCount !== candidate.rollouts.length ||
          candidate.rollouts.some((r, i) => r.seed !== contest.seeds[i]) ||
          candidate.rollouts.some((r) => r.error || r.violations.length)
        )
          throw new Error(
            "Current local Futures evidence must pass before owner approval",
          );
      }
      const active = state.releases.find(
        (r) => r.definition.id === id && r.status === "installed",
      );
      if (
        release.definition.parentVersion &&
        active?.definition.version !== release.definition.parentVersion
      )
        throw new Error(
          "Parent version changed; rebuild the proposal against the installed release",
        );
      state.releases
        .filter((r) => r.definition.id === id && r.status === "installed")
        .forEach((r) => {
          r.status = "superseded";
        });
      release.status = "installed";
      release.approvedAt = new Date().toISOString();
      if (trust) {
        trust.current = "HUMAN_APPROVED";
        trust.grants = [];
        trust.stages.push({ stage: "HUMAN_APPROVED", at: release.approvedAt });
      }
      release.installedAt = release.approvedAt;
      release.approvalWaitMs =
        Date.parse(release.approvedAt) - Date.parse(release.report.completedAt);
      release.approvalDecisionMs = Math.round(performance.now() - started);
      audit(
        state,
        "release.approved",
        id,
        `Human approved ${version} with digest ${expectedDigest}`,
      );
      return release;
    });
  }
  async reject(id: string, version: string, expectedDigest: string) {
    return this.store.transaction((state) => {
      const release = state.releases.find(
        (r) => r.definition.id === id && r.definition.version === version,
      );
      if (!release || !["review", "rejected"].includes(release.status))
        throw new Error("Release is not awaiting approval");
      assertRelease(release, expectedDigest);
      if (release.status === "rejected") return release;
      release.status = "rejected";
      release.rejectedAt = new Date().toISOString();
      audit(
        state,
        "release.rejected",
        id,
        `Human rejected ${version}; no tool installed`,
      );
      return release;
    });
  }
  async trigger(id: string, rawEvent: unknown): Promise<Execution> {
    const event = eventSchema.parse(rawEvent);
    const key = `${id}:${event.id}`;
    const current = this.pendingEvents.get(key);
    if (current) return current;
    const pending = this.execute(id, event);
    this.pendingEvents.set(key, pending);
    try {
      return await pending;
    } finally {
      this.pendingEvents.delete(key);
    }
  }
  private async execute(id: string, event: z.infer<typeof eventSchema>) {
    const events: NonNullable<Execution["events"]> = [];
    const observe = (event: string, details: string) =>
      events.push({ at: new Date().toISOString(), event, details });
    observe(
      "request.received",
      "Validated event envelope; payload omitted from lifecycle telemetry",
    );
    const state = await this.store.read();
    const release = state.releases.find(
      (r) => r.definition.id === id && r.status === "installed",
    );
    if (!release?.approvedAt)
      throw new Error("Capability is not installed and approved");
    assertRelease(release, release.digest);
    if (release.definition.executable?.interface === "city/v1") {
      const previousExecution = state.executions.find(
        (e) =>
          e.capabilityId === id &&
          e.version === release.definition.version &&
          e.eventId === event.id &&
          e.status === "success",
      );
      if (previousExecution) return previousExecution;
      const provider = new TwinEnvironmentProvider(this.store);
      const city = await provider.observe();
      const execution = await this.sandbox.run(
        release.definition,
        event,
        this.store,
        undefined,
        {
          kind: "city",
          mode: "TWIN",
          provider,
          goal: release.definition.goal!,
          binding: city.id,
        },
      );
      await this.store.transaction((s) => {
        s.executions.push(execution);
        s.audit.push({
          at: execution.endedAt,
          action: "city.execution." + execution.status,
          capabilityId: id,
          details: execution.error ?? execution.id,
        });
      });
      return execution;
    }
    if (release.definition.executable) {
      const connector = state.live?.trust[release.digest]?.connector;
      if (!connector)
        throw new Error(
          "Select replay/shadow/live deployment before invoking this capability",
        );
      const result = await this.runConnected(id, connector);
      const latest = result.executions.at(-1);
      if (latest) return latest;
      const at = new Date().toISOString();
      const ignored: Execution = {
        id: crypto.randomUUID(),
        capabilityId: id,
        version: release.definition.version,
        eventId: event.id,
        trigger: event.type,
        startedAt: at,
        endedAt: at,
        latencyMs: 0,
        status: "ignored",
        trace: [],
        outcome: {
          reason: "No unseen eligible emails",
          reportId: result.report.id,
        },
        permissionDenials: 0,
        toolCalls: 0,
        model: "deterministic-primitives",
        tokens: 0,
        estimatedCost: 0,
        sandbox: this.sandbox.constructor.name,
      };
      await this.store.transaction((s) => s.executions.push(ignored));
      return ignored;
    }
    observe(
      "capability.resolved",
      `${id} v${release.definition.version}; digest ${release.digest}`,
    );
    observe("permissions.loaded", release.definition.permissions.join(", "));
    observe(
      "sandbox.started",
      "Allowlisted DAG; source content is untrusted data; broker enforces policy per invocation",
    );
    const existing = state.executions.find(
      (e) =>
        e.capabilityId === id &&
        e.eventId === event.id &&
        e.status === "success",
    );
    if (existing) return existing;
    const execution = await this.sandbox.run(
      release.definition,
      event,
      this.store,
    );
    observe(
      "sandbox.completed",
      `${execution.status}; ${execution.toolCalls} calls; ${execution.permissionDenials} denials; ${execution.latencyMs}ms`,
    );
    execution.events = events;
    await this.store.transaction((s) => {
      s.executions.push(execution);
      audit(
        s,
        `execution.${execution.status}`,
        id,
        `${execution.id}: ${execution.error ?? event.id}`,
      );
    });
    return execution;
  }
  async repair(id: string) {
    const state = await this.store.read();
    const active = state.releases.find(
      (r) => r.definition.id === id && r.status === "installed",
    );
    if (!active) throw new Error("No installed capability");
    const failure = [...state.executions]
      .reverse()
      .find(
        (e) =>
          e.capabilityId === id &&
          e.version === active.definition.version &&
          e.status === "failed" &&
          e.error?.includes("SOURCE_SCHEMA_CHANGED"),
      );
    if (!failure)
      throw new Error(
        "No reproducible source schema failure for this installed version",
      );
    const previous = active.definition;
    if (
      state.audit.filter(
        (a) =>
          a.action === "repair.proposed" &&
          a.capabilityId === id &&
          a.details.includes(`parent=${previous.version};`),
      ).length >= previous.policies.maxRepairAttempts
    )
      throw new Error("Repair attempt limit reached");
    const reproduction = await this.sandbox.run(
      previous,
      {
        id: "repair-reproduction",
        type: "new_job_posting",
        payload: { posting: postings.changed },
      },
      new (await import("./store")).MemoryStateStore(),
    );
    if (
      reproduction.status !== "failed" ||
      !reproduction.error?.includes("SOURCE_SCHEMA_CHANGED")
    )
      throw new Error("Failure could not be reproduced");
    const cap = structuredClone(previous);
    cap.version = bump(previous.version, "patch");
    cap.parentVersion = previous.version;
    cap.createdAt = new Date().toISOString();
    cap.reason =
      "Source posting schema changed. Accept v2 fields while preserving v1 compatibility.";
    const normalization = cap.nodes.find(
      (n) => n.operation === "posting.normalize",
    );
    if (!normalization) throw new Error("No supported normalization patch");
    normalization.config.schemaVersion = "v2";
    validateCapability(cap);
    const fixed = await this.sandbox.run(
      cap,
      {
        id: "repair-regression",
        type: "new_job_posting",
        payload: { posting: postings.changed },
      },
      new (await import("./store")).MemoryStateStore(),
    );
    if (fixed.status !== "success") throw new Error("Repair regression failed");
    const release = await this.stage(
      cap,
      "EXTEND",
      {
        model: "deterministic-schema-repair",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: 0,
      },
      previous,
    );
    release.report.checks.push({
      name: "schema migration regression",
      category: "test",
      passed: fixed.status === "success",
      details:
        "Reproduced v1 failure and executed v2 repair against changed fixture",
      durationMs: fixed.latencyMs,
    });
    await this.store.transaction((s) => {
      const persisted = s.releases.find((r) => r.digest === release.digest)!;
      persisted.report = release.report;
      audit(
        s,
        "repair.proposed",
        id,
        `parent=${previous.version}; ${previous.version} → ${cap.version}; reproduced ${failure.id}; no new permissions`,
      );
    });
    return release;
  }
  async rollback(id: string, version: string) {
    return this.store.transaction((state) => {
      const target = state.releases.find(
        (r) => r.definition.id === id && r.definition.version === version,
      );
      if (!target?.approvedAt || !target.report.passed)
        throw new Error(
          "Rollback target must be a previously approved passing release",
        );
      assertRelease(target, target.digest);
      state.releases
        .filter((r) => r.definition.id === id && r.status === "installed")
        .forEach((r) => {
          r.status = "superseded";
        });
      target.status = "installed";
      if (target.definition.executable && state.live) {
        for (const release of state.releases.filter(
          (r) => r.definition.id === id,
        )) {
          const trust = state.live.trust[release.digest];
          if (trust) {
            trust.current = "REVOKED";
            trust.grants = [];
          }
        }
      }
      target.installedAt = new Date().toISOString();
      if (state.city?.deployment?.id === id) delete state.city.deployment;
      audit(state, "release.rollback", id, `Restored approved ${version}`);
      return target;
    });
  }
  private async connector(mode: "fixture" | "google"): Promise<Connector> {
    if (mode === "google" && process.env.STORE_PROVIDER === "dynamodb")
      throw new Error(
        "Live Google dispatch currently requires serialized local persistence",
      );
    return mode === "fixture"
      ? new FixtureConnector()
      : this.google.connector();
  }
  async replay(
    id: string,
    version: string,
    expectedDigest: string,
    mode: "fixture" | "google",
  ) {
    const state = await this.store.read();
    const release = state.releases.find(
      (r) => r.definition.id === id && r.definition.version === version,
    );
    if (
      !release ||
      !release.definition.executable ||
      ["blocked", "rejected"].includes(release.status)
    )
      throw new Error("A passing generated executable release is required");
    assertRelease(release, expectedDigest);
    const result = await replayCapability(
      release,
      await this.connector(mode),
      this.store,
      this.sandbox,
    );
    await this.store.transaction((s) => {
      s.live ??= emptyLive();
      s.live.replays = [...s.live.replays.slice(-19), result.report];
      const trust = s.live.trust[release.digest];
      if (!trust) throw new Error("Missing local trust record");
      if (result.report.passed) {
        if (!["LIVE", "SHADOW", "HUMAN_APPROVED"].includes(trust.current))
          trust.current = "REPLAYED";
        trust.replayId = result.report.id;
        trust.stages.push({ stage: "REPLAYED", at: result.report.at });
      }
      s.executions.push(...result.executions);
      audit(
        s,
        "replay.completed",
        id,
        `${mode}; ${result.report.emailsInspected} emails; ${result.report.effects.length} proposed effects; ${result.report.externalWrites} external writes`,
      );
    });
    return result.report;
  }
  async promote(
    id: string,
    version: string,
    expectedDigest: string,
    connector: "fixture" | "google",
    mode: "SHADOW" | "LIVE",
    permissions: string[],
  ) {
    const binding = await this.connector(connector);
    if (
      connector === "google" &&
      mode === "LIVE" &&
      !(await this.google.status()).calendarWriteConsent
    )
      throw new Error(
        "Authorize Calendar writes through Google consent before promotion",
      );
    return this.store.transaction((s) => {
      const release = s.releases.find(
        (r) =>
          r.definition.id === id &&
          r.definition.version === version &&
          r.status === "installed",
      );
      if (!release?.approvedAt || !release.definition.executable)
        throw new Error("Human-approved installed executable required");
      assertRelease(release, expectedDigest);
      const trust = s.live?.trust[release.digest];
      const replay = s.live?.replays.find((r) => r.id === trust?.replayId);
      if (
        !trust ||
        !replay?.passed ||
        replay.connector !== connector ||
        replay.binding !== binding.binding ||
        replay.digest !== release.digest ||
        replay.externalWrites !== 0
      )
        throw new Error("Passing replay on this connector binding is required");
      const expected =
        mode === "LIVE"
          ? release.definition.permissions
          : ["calendar.read", "gmail.read"];
      if (digest([...permissions].sort()) !== digest([...expected].sort()))
        throw new Error("Approve exactly the displayed permission delta");
      trust.current = mode;
      trust.connector = connector;
      trust.binding = binding.binding;
      trust.grants = trustSchema.shape.grants.parse(
        mode === "LIVE"
          ? [...release.definition.permissions]
          : ["calendar.read", "gmail.read"],
      );
      trust.stages.push({ stage: mode, at: new Date().toISOString() });
      audit(
        s,
        "authority.promoted",
        id,
        `${mode} ${connector}; digest ${expectedDigest}; grants ${trust.grants.join(",")}`,
      );
      return trust;
    });
  }
  async revoke(id: string) {
    return this.store.transaction((s) => {
      s.live ??= emptyLive();
      if (s.city?.deployment?.id === id) delete s.city.deployment;
      for (const release of s.releases.filter((r) => r.definition.id === id)) {
        const trust = s.live.trust[release.digest];
        if (trust) {
          trust.current = "REVOKED";
          trust.grants = [];
          trust.stages.push({ stage: "REVOKED", at: new Date().toISOString() });
        }
        if (s.live.schedules[release.digest])
          s.live.schedules[release.digest].enabled = false;
      }
      audit(
        s,
        "authority.revoked",
        id,
        "All versions lost connector write authority; polling disabled",
      );
      return { revoked: true };
    });
  }
  async pauseLive(paused: boolean) {
    return this.store.transaction((s) => {
      s.live ??= emptyLive();
      s.live.paused = paused;
      audit(s, "authority.pause", "live", String(paused));
      return { paused };
    });
  }
  async runConnected(id: string, mode: "fixture" | "google") {
    const state = await this.store.read();
    const release = state.releases.find(
      (r) => r.definition.id === id && r.status === "installed",
    );
    if (!release?.definition.executable)
      throw new Error("Installed executable required");
    assertRelease(release, release.digest);
    const trust = state.live?.trust[release.digest];
    const connector = await this.connector(mode);
    if (
      state.live?.paused ||
      !trust ||
      !["LIVE", "SHADOW"].includes(trust.current) ||
      trust.connector !== mode ||
      trust.binding !== connector.binding ||
      !trust.grants.includes("gmail.read") ||
      !trust.grants.includes("calendar.read")
    )
      throw new Error(
        "Deployment authority is missing, stale, revoked or paused",
      );
    const result = await replayCapability(
      release,
      connector,
      this.store,
      this.sandbox,
      trust.current as "LIVE" | "SHADOW",
    );
    await this.store.transaction((s) => {
      s.live ??= emptyLive();
      s.live.replays = [...s.live.replays.slice(-19), result.report];
      s.executions.push(...result.executions);
      audit(
        s,
        "connected.execution",
        id,
        `${mode} ${trust.current}; ${result.report.externalWrites} external writes; passed=${result.report.passed}`,
      );
    });
    return result;
  }
  async schedule(id: string, everySeconds: number, enabled: boolean) {
    z.number().int().min(60).max(86400).parse(everySeconds);
    return this.store.transaction((s) => {
      const release = s.releases.find(
        (r) => r.definition.id === id && r.status === "installed",
      );
      const trust = release && s.live?.trust[release.digest];
      if (
        !release ||
        !trust?.connector ||
        !trust.binding ||
        !["LIVE", "SHADOW"].includes(trust.current)
      )
        throw new Error("An admitted deployment is required before scheduling");
      s.live!.schedules[release.digest] = {
        digest: release.digest,
        connector: trust.connector,
        binding: trust.binding,
        everySeconds,
        enabled,
        nextAt: new Date(Date.now() + everySeconds * 1000).toISOString(),
      };
      audit(
        s,
        "trigger.scheduled",
        id,
        `${everySeconds}s polling; enabled=${enabled}`,
      );
      return s.live!.schedules[release.digest];
    });
  }
  async tick(now = Date.now()) {
    const state = await this.store.read();
    if (state.live?.paused) return;
    for (const [key, schedule] of Object.entries(state.live?.schedules ?? {})) {
      if (!schedule.enabled || Date.parse(schedule.nextAt) > now) continue;
      const release = state.releases.find(
        (r) => r.digest === key && r.status === "installed",
      );
      if (!release) continue;
      // One process owns the durable schedule. Claim due time before dispatch; broker checks grants again.
      const claimed = await this.store.transaction((s) => {
        const current = s.live!.schedules[key];
        if (
          !current.enabled ||
          Date.parse(current.nextAt) > now ||
          s.live?.paused
        )
          return false;
        current.nextAt = new Date(
          now + current.everySeconds * 1000,
        ).toISOString();
        return true;
      });
      if (!claimed) continue;
      let failure: string | undefined;
      try {
        const run = await this.runConnected(
          release.definition.id,
          schedule.connector,
        );
        if (!run.report.passed)
          failure = "Scheduled execution failed; inspect traces";
      } catch {
        failure =
          "Scheduled execution blocked or connector unavailable; inspect admission and consent";
      }
      await this.store.transaction((s) => {
        s.live!.schedules[key].lastRun = new Date(now).toISOString();
        s.live!.schedules[key].lastError = failure;
      });
    }
  }
  async deleteReplayEvidence() {
    return this.store.transaction((s) => {
      if (s.live) {
        const replayExecutions = new Set(
          s.live.replays.flatMap((r) => r.timeline.map((e) => e.executionId)),
        );
        s.executions = s.executions.filter((e) => !replayExecutions.has(e.id));
        s.live.replays = [];
        for (const trust of Object.values(s.live.trust)) {
          trust.replayId = undefined;
          trust.grants = [];
          if (["LIVE", "SHADOW"].includes(trust.current))
            trust.current = "REVOKED";
        }
      }
      audit(
        s,
        "replay.deleted",
        "live",
        "Replay summaries and linked traces deleted; live grants revoked",
      );
      return { deleted: true };
    });
  }
  async admission(id: string, version: string) {
    const state = await this.store.read();
    const release = state.releases.find(
      (r) => r.definition.id === id && r.definition.version === version,
    );
    if (!release) throw new Error("Release not found");
    const trust = state.live?.trust[release.digest];
    const replay = state.live?.replays.find((r) => r.id === trust?.replayId);
    return {
      artifactHash: release.digest,
      version,
      provider: release.usage.model,
      sourceHash: release.definition.executable
        ? digest(release.definition.executable.source)
        : undefined,
      functionalTests: release.report.checks.filter(
        (c) => c.category === "test",
      ),
      heldOutTests: release.report.checks.filter((c) =>
        c.name.startsWith("held-out"),
      ),
      security: release.report.checks.filter((c) => c.category === "security"),
      sandbox: this.sandbox.constructor.name,
      requestedPermissions: release.definition.permissions,
      resourceBudget: release.definition.policies,
      replay,
      futures: release.futures
        ? state.contests?.find((c) => c.id === release.futures?.contestId)
        : undefined,
      trust,
      prohibitedActions: release.report.checks
        .filter((c) => c.category === "security" && c.passed)
        .map((c) => c.name),
      recommendation: !release.report.passed
        ? "REJECT"
        : release.definition.executable?.interface === "city/v1"
          ? release.futures?.passed
            ? "DIGITAL TWIN / OWNER APPROVAL REQUIRED"
            : "LOCAL FUTURES REQUIRED"
          : !release.definition.executable
            ? "HUMAN APPROVAL REQUIRED"
            : !replay?.passed
              ? "REPLAY ONLY"
              : !release.approvedAt
                ? "HUMAN APPROVAL REQUIRED"
                : trust?.current === "SHADOW"
                  ? "SHADOW"
                  : "ELIGIBLE FOR LIVE",
    };
  }
  async exportCapsule(id: string, version: string) {
    const state = await this.store.read();
    const release = state.releases.find(
      (r) => r.definition.id === id && r.definition.version === version,
    );
    if (!release) throw new Error("Release not found");
    assertRelease(release, release.digest);
    let capsule = packageCapsule(release, await signingKey(this.google.vault));
    if (process.env.FORGE_KMS_KEY_ID) {
      if (process.env.FORGE_RUNTIME_MODE !== "aws")
        throw new Error("KMS signing requires explicit AWS mode");
      capsule = await signWithKms(capsule, process.env.FORGE_KMS_KEY_ID);
    }
    if (
      process.env.FORGE_ARTIFACT_BUCKET &&
      process.env.FORGE_RUNTIME_MODE !== "aws"
    )
      throw new Error("S3 artifact storage requires explicit AWS mode");
    const stored = process.env.FORGE_ARTIFACT_BUCKET
      ? await storeCapsule(capsule, process.env.FORGE_ARTIFACT_BUCKET)
      : undefined;
    await this.store.transaction((s) =>
      audit(
        s,
        "capsule.exported",
        id,
        capsule.signature.provider +
          "; hash " +
          capsule.contentHash +
          "; " +
          (stored ? "S3 request " + stored.requestId : "local download"),
      ),
    );
    return capsule;
  }
  async importCapsule(raw: unknown) {
    const verified = verifyCapsule(raw);
    const cap = structuredClone(verified.capsule.payload.spec);
    const state = await this.store.read();
    if (state.releases.some((r) => r.definition.id === cap.id)) {
      const suffix = verified.capsule.contentHash.slice(0, 8);
      cap.id = `import-${cap.id.slice(0, 45)}-${suffix}`;
      cap.toolContract = deriveToolContract(cap.id, cap.trigger);
    }
    delete cap.parentVersion;
    cap.createdAt = new Date().toISOString();
    const release = await this.stage(cap, "SYNTHESIZE", {
      model: "imported-signed-artifact",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    });
    await this.store.transaction((s) => {
      const trust = s.live!.trust[release.digest];
      trust.current = "UNTRUSTED";
      trust.imported = true;
      trust.grants = [];
      trust.replayId = undefined;
      audit(
        s,
        "capsule.imported",
        cap.id,
        `Signature VALID; publisher trust NOT ESTABLISHED; content ${verified.capsule.contentHash}; local checks ${release.report.passed}; authority reset`,
      );
    });
    return {
      release,
      signature: verified.signature,
      publisherTrust: verified.publisherTrust,
      localTrust: "NOT ESTABLISHED",
      grants: [],
    };
  }
  async prepareWorld(scene: "active-day" | "night-arrival" | "away-45") {
    return this.store.transaction((state) => {
      const world = createWorld();
      if (scene === "night-arrival") {
        world.timeOfDay = "night";
        world.minute = 1260;
        world.presence = "away";
        world.awaySince = 1200;
        for (const room of Object.keys(
          world.lights,
        ) as (keyof typeof world.lights)[])
          world.lights[room] = false;
        world.doorLocked = true;
        world.temperature = 21;
        world.computerOn = world.tvOn = world.appliancesOn = false;
      }
      if (scene === "away-45") {
        world.presence = "away";
        world.minute = 525;
        world.awaySince = 480;
      }
      state.world = world;
      audit(
        state,
        "world.scene.prepared",
        "world",
        `Owner prepared simulation input: ${scene}; installed capabilities preserved`,
      );
      return world;
    });
  }
  async resetWorldDemo() {
    if (
      this.pendingEvents.size ||
      [...this.builds.values()].some((b) => b.status === "building")
    )
      throw new Error(
        "Wait for active builds and executions before resetting World",
      );
    return this.store.transaction((state) => {
      // Only entirely World-domain histories qualify. Mixed-domain capabilities
      // and their records are preserved, even when their IDs look like routines.
      const ids = new Set(
        state.releases
          .filter((release) =>
            state.releases
              .filter((r) => r.definition.id === release.definition.id)
              .every((r) =>
                r.definition.nodes.every((n) =>
                  worldOperations.includes(
                    n.operation as (typeof worldOperations)[number],
                  ),
                ),
              ),
          )
          .map((r) => r.definition.id),
      );
      state.releases = state.releases.filter((r) => !ids.has(r.definition.id));
      state.executions = state.executions.filter(
        (e) => !ids.has(e.capabilityId),
      );
      for (const [key, effect] of Object.entries(state.effects))
        if (ids.has(effect.capabilityId)) delete state.effects[key];
      state.world = createWorld();
      audit(
        state,
        "world.demo.reset",
        "world",
        `Owner reset World-only histories: ${[...ids].join(", ") || "none"}; unrelated capabilities and audit preserved`,
      );
      return { removedCapabilityIds: [...ids], world: state.world };
    });
  }
  async probeWorldSecurity() {
    const state = await this.store.read();
    const release = state.releases.find(
      (r) => r.status === "installed" && r.definition.id === "leaving-home",
    );
    if (!release)
      throw new Error(
        "Install Leaving Home before testing the delivery attack",
      );
    assertRelease(release, release.digest);
    const event = {
      id: `delivery-${crypto.randomUUID()}`,
      type: "manual" as const,
      payload: { text: maliciousDelivery },
    };
    const broker = new PermissionBroker(release.definition, event, this.store);
    try {
      await broker.invoke(release.definition.nodes[0].id, "door.unlock");
    } catch {
      /* The recorded broker trace determines the outcome. */
    }
    const step = broker.trace.at(-1);
    if (step?.status !== "denied" || broker.permissionDenials !== 1)
      throw new Error(
        "Security probe did not block the unauthorized operation",
      );
    await this.store.transaction((s) => {
      s.world ??= createWorld();
      s.world.mailbox = [...s.world.mailbox.slice(-19), maliciousDelivery];
      s.world.alert = {
        message: step.error!,
        operation: step.operation,
        permissionDenials: broker.permissionDenials,
        at: new Date().toISOString(),
        nodeId: step.nodeId,
        status: "denied",
      };
      audit(
        s,
        "world.security.blocked",
        release.definition.id,
        `${step.operation}: ${step.error}`,
      );
    });
    return {
      untrustedContent: maliciousDelivery,
      step,
      permissionDenials: broker.permissionDenials,
      doorLocked: (await this.store.read()).world!.doorLocked,
    };
  }
}
export function assertRelease(release: Release, expectedDigest: string) {
  validateCapability(release.definition);
  if (
    !release.report.passed ||
    release.report.checks.length <
      (release.definition.executable?.interface === "city/v1" ? 8 : 22) ||
    release.report.checks.some((c) => !c.passed) ||
    release.report.digest !== expectedDigest ||
    release.digest !== expectedDigest ||
    digest(release.definition) !== expectedDigest
  )
    throw new Error("Release integrity or validation failed");
}
function audit(
  state: State,
  action: string,
  capabilityId: string,
  details: string,
) {
  state.audit.push({
    at: new Date().toISOString(),
    action,
    capabilityId,
    details,
  });
}
function compareVersions(a: string, b: string) {
  const aa = a.split(".").map(Number),
    bb = b.split(".").map(Number);
  return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
}
