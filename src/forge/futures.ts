import { randomBytes, randomUUID } from "node:crypto";
import {
  advanceCity,
  controlCity,
  futureFrame,
  objectiveScore,
  random,
  violations,
} from "./city-engine";
import {
  metricNames,
  hazardKinds,
  type Candidate,
  type City,
  type CityContest,
  type GoalContract,
} from "./city-contracts";
import { MemoryStateStore } from "./store";
import { TwinEnvironmentProvider, type CityContext } from "./environment";
import { policyFeatures, behaviorRepresentation } from "./policy-features";
import {
  predictPolicy,
  embedBehavior,
  behaviorDistance,
} from "./policy-model-runtime";
import { modelReady, predictFeatures } from "./world-model";
import { observeForecastNodes, forecastFeatures } from "./forecast-features";
import type { Sandbox } from "./sandbox";
import { validateCapability, derivePermissions, type Capability } from "./spec";
import { deriveToolContract } from "./contracts";
import { digest } from "./hash";
import { compileExecutable, algorithmHash } from "./executable";
export function cityCapability(
  goal: GoalContract,
  source: string,
  name: string,
  previous?: Capability,
): Capability {
  const id = previous?.id ?? "city-policy-" + randomUUID().slice(0, 8);
  const nodes: Capability["nodes"] = [
    {
      id: "observe",
      operation: "city.observe",
      label: "Observe authoritative environment",
      dependsOn: [],
      config: {},
      timeoutMs: 5000,
      maxAttempts: 1,
    },
    {
      id: "execute",
      operation: "executable.run",
      label: "Execute generated pure algorithm",
      dependsOn: ["observe"],
      config: {},
      timeoutMs: 5000,
      maxAttempts: 1,
    },
    {
      id: "apply",
      operation: "city.apply",
      label: "Broker typed actions",
      dependsOn: ["observe", "execute"],
      config: { cityActions: goal.actions },
      timeoutMs: 5000,
      maxAttempts: 1,
    },
  ];
  const version = previous
    ? previous.version
        .split(".")
        .map((v, i) => (i === 1 ? Number(v) + 1 : i === 2 ? 0 : Number(v)))
        .join(".")
    : "1.0.0";
  return validateCapability({
    id,
    name,
    description: goal.interpretation,
    version,
    parentVersion: previous?.version,
    createdAt: new Date().toISOString(),
    intent: goal.goal,
    trigger: "manual",
    toolContract: deriveToolContract(id, "manual"),
    nodes,
    edges: nodes.flatMap((n) =>
      n.dependsOn.map((from) => ({ from, to: n.id })),
    ),
    permissions: derivePermissions(nodes),
    policies: {
      approvalRequired: true,
      network: "broker-only",
      maxRuntimeMs: 15000,
      maxToolCalls: 3,
      maxRepairAttempts: 1,
    },
    reason:
      "Admitted only after measured stochastic Futures and exact owner approval",
    goal,
    executable: { interface: "city/v1", language: "typescript", source },
  });
}
export function pairedSeeds(count = 20) {
  return Array.from({ length: count }, () => randomBytes(4).readUInt32LE());
}
export async function rollout(
  snapshot: City,
  seed: number,
  goal: GoalContract,
  cap: Capability | undefined,
  sandbox: Sandbox,
  capture: boolean,
  suppressedOperations: string[] = [],
) {
  const started = performance.now();
  const store = new MemoryStateStore();
  await store.transaction((s) => {
    s.city = structuredClone(snapshot);
    s.city.seed = seed;
    s.city.paused = false;
    delete s.city.deployment;
    s.city.events = [];
  });
  const provider = new TwinEnvironmentProvider(store);
  const frames: Candidate["frames"] = [];
  const failures = new Set<string>();
  // Exogenous weather and incident draws use a separate stream, paired across policies.
  const shock = { seed };
  const location =
    snapshot.nodes[Math.floor(random(shock) * snapshot.nodes.length)];
  const kind = hazardKinds[Math.floor(random(shock) * hazardKinds.length)];
  const intensity = 0.2 + random(shock) * 0.4;
  const rain = random(shock) * 0.8,
    wind = random(shock) * 0.8;
  let error: string | undefined;
  let firstActions: import("./city-contracts").CityAction[] = [];
  let early = snapshot.metrics;
  for (let elapsed = 0; elapsed <= 120; elapsed += 4) {
    if (elapsed % 40 === 0 && elapsed < 120 && cap) {
      const context: CityContext = {
        kind: "city",
        mode: "FUTURES",
        provider,
        goal,
        binding: snapshot.id,
        suppressedOperations,
      };
      const execution = await sandbox.run(
        cap,
        {
          id: "future-" + seed + "-" + elapsed,
          type: cap.trigger,
          payload: {},
        },
        store,
        undefined,
        context,
      );
      if (elapsed === 0) firstActions = context.output?.actions ?? [];
      if (execution.status !== "success") {
        error = execution.error ?? "Sandbox execution failed";
        failures.add(error);
        break;
      }
    }
    await store.transaction((s) => {
      const city = s.city!;
      if (elapsed === 24) {
        controlCity(
          city,
          { operation: "weather.set", rain, wind },
          "simulation",
        );
        controlCity(
          city,
          {
            operation: "hazard.create",
            kind,
            x: location.x,
            y: location.y,
            intensity,
            radius: 100 + random(shock) * 100,
          },
          "simulation",
        );
      }
      if (elapsed < 120) advanceCity(city, 4, false);
      if (elapsed === 16) early = structuredClone(city.metrics);
      for (const failure of violations(city, goal)) failures.add(failure);
      if (capture && [0, 24, 60, 120].includes(elapsed))
        frames.push({ ...futureFrame(city), seed });
    });
  }
  const city = await provider.observe();
  return {
    rollout: {
      seed,
      metrics: city.metrics,
      score: objectiveScore(city.metrics, goal),
      violations: [...failures].slice(0, 40),
      durationMs: Math.round(performance.now() - started),
      error,
    },
    frames,
    screeningFeatures: policyFeatures(
      snapshot,
      goal,
      firstActions,
      early,
      Boolean(error),
    ),
    behavior: behaviorRepresentation(firstActions, snapshot.metrics, early),
  };
}
export function summarize(
  rollouts: Candidate["rollouts"],
): NonNullable<Candidate["summary"]> {
  const scores = rollouts.map((r) => r.score).sort((a, b) => a - b);
  const mean = (values: number[]) =>
    values.reduce((sum, n) => sum + n, 0) / Math.max(1, values.length);
  return {
    mean: mean(scores),
    median: scores.length
      ? (scores[Math.floor((scores.length - 1) / 2)] +
          scores[Math.floor(scores.length / 2)]) /
        2
      : 0,
    p95: scores[Math.max(0, Math.ceil(scores.length * 0.95) - 1)] ?? 0,
    worst: scores.at(-1) ?? 0,
    failureRate:
      rollouts.filter((r) => r.error || r.violations.length).length /
      Math.max(1, rollouts.length),
    constraintViolations: rollouts.reduce(
      (sum, r) => sum + r.violations.length,
      0,
    ),
    metricsMean: Object.fromEntries(
      metricNames.map((metric) => [
        metric,
        mean(rollouts.map((r) => r.metrics[metric])),
      ]),
    ) as City["metrics"],
  };
}
export async function evaluateFutures(
  contest: CityContest,
  snapshot: City,
  sandbox: Sandbox,
  persist: () => Promise<void>,
  previous?: Capability,
  options?: { mode: "adaptive" | "exhaustive"; count?: 20 | 30 | 40 },
) {
  const goal = contest.goal!;
  const hashes = new Set<string>();
  const algorithmHashes = new Set<string>();
  for (const candidate of contest.candidates) {
    candidate.status = "testing";
    try {
      compileExecutable(candidate.source, "city/v1");
      candidate.algorithmHash = algorithmHash(candidate.source);
      if (
        hashes.has(candidate.hash) ||
        algorithmHashes.has(candidate.algorithmHash)
      ) {
        candidate.status = "duplicate";
        candidate.checks.push({
          name: "Distinct source",
          passed: false,
          details:
            "Identical source or algorithm structure after normalizing names and literals; duplicate excluded",
        });
        continue;
      }
      hashes.add(candidate.hash);
      algorithmHashes.add(candidate.algorithmHash);
      candidate.checks.push({
        name: "Different algorithm structure",
        passed: true,
        details:
          "Syntax-tree shape differs after normalizing variable names and numeric/string literals; names and constants alone do not qualify",
      });
      candidate.checks.push({
        name: "Strict TypeScript and restricted syntax",
        passed: true,
        details: "Actual compiler accepted city/v1",
      });
      candidate.status = "generated";
    } catch (e) {
      candidate.status = "compile_failed";
      const failure = (
        e instanceof Error ? e.message : "Compile failure"
      ).slice(0, 600);
      candidate.checks.push({
        name: "Strict compile",
        passed: false,
        details: failure,
      });
      candidate.attempts[candidate.attempts.length - 1].failure = failure;
    }
  }
  contest.status = "futures";
  const adaptive =
    (options?.mode ?? process.env.FORGE_FUTURES_MODE ?? "adaptive") ===
      "adaptive" && modelReady();
  const observed = observeForecastNodes(snapshot);
  const ood =
    adaptive &&
    (Boolean(snapshot.map) ||
      snapshot.nodes.some(
        (_, i) =>
          predictFeatures(
            forecastFeatures(snapshot, observed, observed, observed, i, 120),
          ).lowConfidence,
      ));
  let budget = options?.count ?? (ood ? 40 : 20);
  if (contest.seeds.length < budget)
    contest.seeds.push(...pairedSeeds(budget - contest.seeds.length));
  const stopped = new Set<string>();
  await persist();
  for (let index = 0; index < budget; index++) {
    const seed = contest.seeds[index];
    const baseline = await rollout(
      snapshot,
      seed,
      goal,
      previous,
      sandbox,
      false,
    );
    contest.baseline.push(baseline.rollout);
    const order = ood
      ? [...contest.candidates]
      : [...contest.candidates].sort(
          (a, b) =>
            (a.screening?.predictedUnsafe ?? 0) -
              (b.screening?.predictedUnsafe ?? 0) ||
            (a.screening?.predictedLoss ?? 0) -
              (b.screening?.predictedLoss ?? 0),
        );
    for (const candidate of order) {
      if (["compile_failed", "duplicate"].includes(candidate.status)) continue;
      if (stopped.has(candidate.id)) continue;
      const cap = cityCapability(
        goal,
        candidate.source,
        candidate.name,
        previous,
      );
      const result = await rollout(
        snapshot,
        seed,
        goal,
        cap,
        sandbox,
        index === 0 || index === 10 || index === 19,
      );
      candidate.rollouts.push(result.rollout);
      if (index === 0) {
        const prediction = predictPolicy(result.screeningFeatures);
        const behavior = embedBehavior(result.behavior);
        candidate.screening = {
          predictedUnsafe: prediction?.unsafe,
          predictedUncertainty: prediction?.uncertainty,
          predictedLoss: prediction?.loss,
          behavior: behavior?.embedding,
          cluster: behavior?.cluster,
          allocation: ood
            ? "Outside training support: full simulation"
            : adaptive
              ? "Predictions prioritize testing; actual evidence controls selection"
              : "Exhaustive paired simulation",
        };
        if (
          adaptive &&
          !options?.count &&
          budget === 20 &&
          (prediction?.uncertainty ?? 0) > 0.15
        ) {
          budget = 40;
          if (contest.seeds.length < budget)
            contest.seeds.push(...pairedSeeds(budget - contest.seeds.length));
          candidate.screening.allocation =
            "Risk ensemble disagreement: expanded to 40 actual paired tests";
        }
      }
      candidate.frames.push(...result.frames);
      candidate.frames = candidate.frames.slice(-12);
      candidate.summary = summarize(candidate.rollouts);
      candidate.status = result.rollout.error
        ? "sandbox_failed"
        : candidate.summary.failureRate
          ? "unsafe"
          : "testing";
      if (adaptive && index >= 4 && candidate.summary.failureRate > 0) {
        stopped.add(candidate.id);
        candidate.screening!.allocation =
          "Stopped after " +
          candidate.rollouts.length +
          " actual tests: observed safety failure";
      }
      if (adaptive && !ood && index === 9 && !stopped.has(candidate.id)) {
        const scores = candidate.rollouts.map((r) => r.score);
        const mean = candidate.summary.mean;
        const se = Math.sqrt(
          scores.reduce((s, v) => s + (v - mean) ** 2, 0) /
            Math.max(1, scores.length - 1) /
            scores.length,
        );
        const better = contest.candidates.find((other) => {
          if (
            other.id === candidate.id ||
            other.rollouts.length < 10 ||
            other.summary?.failureRate
          )
            return false;
          const values = other.rollouts.slice(0, 10).map((r) => r.score),
            m = values.reduce((s, v) => s + v, 0) / values.length;
          const se0 = Math.sqrt(
            values.reduce((s, v) => s + (v - m) ** 2, 0) /
              (values.length - 1) /
              values.length,
          );
          return mean - 2.58 * se > m + 2.58 * se0 + 0.005;
        });
        if (better) {
          stopped.add(candidate.id);
          candidate.status = "dominated";
          candidate.screening!.allocation =
            "Stopped after 10 tests: statistically dominated by " +
            better.name +
            "; never approved";
        }
      }
    }
    if (adaptive && !options?.count && index === 19 && budget === 20) {
      const viable = contest.candidates
        .filter((c) => !stopped.has(c.id) && c.summary?.failureRate === 0)
        .sort((a, b) => a.summary!.p95 - b.summary!.p95);
      if (
        viable.length > 1 &&
        viable[1].summary!.p95 - viable[0].summary!.p95 < 0.03
      ) {
        budget = 40;
        if (contest.seeds.length < budget)
          contest.seeds.push(...pairedSeeds(budget - contest.seeds.length));
        viable.forEach((c) => {
          if (c.screening)
            c.screening.allocation =
              "Close measured outcomes: expanded to 40 actual paired tests";
        });
      }
    }
    await persist();
  }
  for (const candidate of contest.candidates) {
    if (candidate.rollouts.length >= 20 && !stopped.has(candidate.id)) {
      candidate.summary = summarize(candidate.rollouts);
      candidate.status = candidate.rollouts.some((r) => r.error)
        ? "sandbox_failed"
        : candidate.summary.constraintViolations
          ? "unsafe"
          : "eligible";
      candidate.checks.push({
        name: candidate.rollouts.length + " paired stochastic Futures",
        passed: candidate.status === "eligible",
        details:
          "120 simulated seconds each; policy executes every 40 seconds through actual isolated worker and broker. Lower objective score is better. Any sampled hard violation or denied action excludes candidate.",
      });
    }
  }
  const eligible = contest.candidates
    .filter((c) => c.status === "eligible")
    .sort(
      (a, b) =>
        a.summary!.p95 - b.summary!.p95 || a.summary!.mean - b.summary!.mean,
    );
  // Identical observed behavior is recorded in addition to syntax-tree diversity.
  for (let i = 0; i < eligible.length; i++)
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i].screening?.behavior,
        b = eligible[j].screening?.behavior;
      if (a && b && behaviorDistance(a, b) < 1e-6) {
        eligible[j].checks.push({
          name: "Behavioral diversity",
          passed: false,
          details:
            "Identical learned action/trajectory representation on the initial paired probe. Source identity alone does not establish behavioral diversity.",
        });
        // Never discard safety evidence or a materially better result on one probe.
        // Use measured behavioral diversity only to break otherwise identical results.
        if (
          eligible[j].summary!.p95 === eligible[i].summary!.p95 &&
          eligible[j].summary!.mean === eligible[i].summary!.mean
        )
          eligible[j].screening!.allocation +=
            "; behavior-equivalent option deprioritized";
      }
    }
  if (!eligible.length)
    throw new Error(
      "All candidates failed admission. No capability installed; inspect compilation, sandbox and hard-constraint evidence.",
    );
  eligible[0].status = "winner";
  contest.winner = eligible[0].id;
  await persist();
}
export function candidateFrom(
  source: string,
  name: string,
  evidence: {
    provider: string;
    model: string;
    requestIds: string[];
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
  },
  cap: Capability,
): Candidate {
  const hash = digest(source);
  return {
    id: "candidate-" + randomUUID().slice(0, 8),
    name,
    source,
    hash,
    ...evidence,
    permissions: cap.permissions.filter((p) =>
      p.startsWith("city."),
    ) as Candidate["permissions"],
    status: "generated",
    checks: [],
    attempts: [{ attempt: 1, hash }],
    rollouts: [],
    frames: [],
  };
}
