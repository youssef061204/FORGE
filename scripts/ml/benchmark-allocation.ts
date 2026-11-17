import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createCity, controlCity } from "../../src/forge/city-engine";
import { developmentGoal, developmentSource } from "../../src/forge/city-model";
import {
  candidateFrom,
  cityCapability,
  evaluateFutures,
} from "../../src/forge/futures";
import { IsolatedSandbox } from "../../src/forge/sandbox";
import { digest } from "../../src/forge/hash";
import type { CityContest } from "../../src/forge/city-contracts";
const policyModelHash = createHash("sha256")
  .update(await readFile("src/forge/policy-model.json"))
  .digest("hex");
const sandbox = new IsolatedSandbox("process"),
  cases = [];
for (let e = 0; e < 6; e++) {
  const city = createCity(34000000 + e * 733),
    goal = structuredClone(developmentGoal);
  if (e > 1)
    controlCity(city, {
      operation: "hazard.create",
      kind: e % 2 ? "flood" : "wildfire",
      x: 900,
      y: 850,
      radius: 250,
      intensity: 0.55,
    });
  const sources = [
    ...Array.from({ length: 3 }, (_, i) => developmentSource(i, true)),
    'function execute(input: ModuleInput): ModuleOutput { const b=input.environment.buildings.find(b=>b.critical); return {actions:b?[{operation:"grid.shed",buildingId:b.id,power:0}]:[]};}',
  ];
  const original: CityContest = {
    id: crypto.randomUUID(),
    request: "Frozen allocation benchmark",
    at: new Date().toISOString(),
    status: "testing",
    interpretation: "Measured paired evaluation",
    environmentId: city.id,
    snapshotHash: digest(city),
    resolution: "SYNTHESIZE",
    goal,
    seeds: Array.from({ length: 40 }, (_, i) => 35000000 + e * 1133 + i * 151),
    baseline: [],
    stages: [],
    candidates: sources.map((source, i) =>
      candidateFrom(
        source,
        "program-" + i,
        {
          provider: "FROZEN FIXTURE",
          model: "no request",
          requestIds: [],
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
        cityCapability(goal, source, "program-" + i),
      ),
    ),
  };
  const results: Record<string, unknown> = {},
    evaluated: Record<string, CityContest> = {};
  for (const mode of (e % 2
    ? ["adaptive", "exhaustive"]
    : ["exhaustive", "adaptive"]) as ("adaptive" | "exhaustive")[]) {
    const contest = structuredClone(original),
      started = performance.now();
    let error: string | undefined;
    try {
      await evaluateFutures(
        contest,
        city,
        sandbox,
        async () => {},
        undefined,
        mode === "exhaustive" ? { mode, count: 40 } : { mode },
      );
    } catch (ex) {
      error = ex instanceof Error ? ex.message : String(ex);
    }
    evaluated[mode] = contest;
    results[mode] = {
      durationMs: performance.now() - started,
      error,
      winner: contest.winner,
      actualTests:
        contest.baseline.length +
        contest.candidates.reduce((s, c) => s + c.rollouts.length, 0),
      candidates: contest.candidates.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        tests: c.rollouts.length,
        summary: c.summary,
        screening: c.screening,
      })),
    };
  }
  const unsafe = evaluated.exhaustive.candidates
    .filter((c) => c.rollouts.some((r) => r.error || r.violations.length))
    .map((c) => c.id);
  cases.push({
    episode: e,
    seed: city.seed,
    results,
    winnerAgreement: evaluated.adaptive.winner === evaluated.exhaustive.winner,
    unsafeMisses: unsafe.filter(
      (id) =>
        evaluated.adaptive.candidates.find((c) => c.id === id)?.status ===
          "winner" ||
        evaluated.adaptive.candidates.find((c) => c.id === id)?.status ===
          "eligible",
    ),
  });
  console.log("Adaptive paired case " + (e + 1) + "/6");
}
await mkdir("artifacts/ml", { recursive: true });
await writeFile(
  "artifacts/ml/futures-benchmark.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      episodes: cases.length,
      seedManifest:
        "six frozen scenes, 40 shared disturbance seeds each; alternating execution order",
      policyModelHash,
      scope:
        "Full City simulation, actual isolated worker and broker. ML estimates never admit an untested candidate.",
      cases,
      winnerAgreement:
        cases.filter((c) => c.winnerAgreement).length / cases.length,
      unsafeMisses: cases.reduce((s, c) => s + c.unsafeMisses.length, 0),
    },
    null,
    2,
  ),
);
