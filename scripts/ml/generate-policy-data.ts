import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  createCity,
  advanceCity,
  controlCity,
} from "../../src/forge/city-engine";
import { cityCapability, rollout } from "../../src/forge/futures";
import { developmentSource, developmentGoal } from "../../src/forge/city-model";
import { runCityExecutable, algorithmHash } from "../../src/forge/executable";
import {
  policyFeatures,
  behaviorRepresentation,
} from "../../src/forge/policy-features";
import { IsolatedSandbox } from "../../src/forge/sandbox";
import { MemoryStateStore } from "../../src/forge/store";
import { TwinEnvironmentProvider } from "../../src/forge/environment";
import { hazardKinds, type CityAction } from "../../src/forge/city-contracts";
const sources = [
  ...[0, 1, 2].map((i) => ({
    name: "generated-fixture-" + i,
    source: developmentSource(i, true),
  })),
  {
    name: "no-policy",
    source:
      "function execute(input: ModuleInput): ModuleOutput { return { actions: [] }; }",
  },
  {
    name: "risk-closure",
    source:
      'function execute(input: ModuleInput): ModuleOutput { return { actions: input.environment.roads.filter(r=>r.risk>.4 && !r.closed).slice(0,48).map(r=>({operation:"road.close",roadId:r.id})) }; }',
  },
  {
    name: "critical-shutdown",
    source:
      'function execute(input: ModuleInput): ModuleOutput { const b=input.environment.buildings.find(b=>b.kind==="hospital");return { actions:b?[{operation:"grid.shed",buildingId:b.id,power:0}]:[] }; }',
  },
  {
    name: "disconnected-route",
    source:
      'function execute(input: ModuleInput): ModuleOutput { const v=input.environment.vehicles[0]; return { actions:[{operation:"vehicle.route",vehicleId:v.id,path:[v.path[0],"n-5-7","n-0-0"]}] }; }',
  },
  {
    name: "undeclared-signal",
    source:
      'function execute(input: ModuleInput): ModuleOutput { return { actions:[{operation:"signal.set",nodeId:input.environment.nodes[0].id,phase:"emergency",seconds:20}] }; }',
  },
];
const sandbox = new IsolatedSandbox("process"),
  rows: unknown[] = [];
let index = 0;
for (const [split, count] of Object.entries({
  train: 64,
  validation: 16,
  heldout: 24,
  shift: 12,
  compositional: 12,
}))
  for (let e = 0; e < count; e++) {
    const seed = 880000 + index * 3571,
      city = createCity(seed),
      scenario = hazardKinds[e % 8];
    const node = city.nodes[(e * 7 + 3) % 48];
    const intensity = split === "shift" ? 0.95 : 0.3 + (e % 6) * 0.09;
    controlCity(city, {
      operation: "hazard.create",
      kind: scenario,
      x: node.x,
      y: node.y,
      radius: split === "shift" ? 420 : 220,
      intensity,
    });
    if (split === "compositional")
      controlCity(city, {
        operation: "hazard.create",
        kind: scenario === "flood" ? "blackout" : "flood",
        x: node.x + 100,
        y: node.y,
        radius: 260,
        intensity: 0.65,
      });
    if (e % 3 === 0) controlCity(city, { operation: "traffic.add", count: 25 });
    advanceCity(city, 20, false);
    const goal = structuredClone(developmentGoal);
    goal.interpretation =
      "Dataset Mission: observed safety and mobility objectives";
    if (e % 4 === 0)
      goal.hard.push({
        metric: "congestion",
        operator: "lte",
        value: Math.min(1, city.metrics.congestion + 0.16),
      });
    if (e % 4 === 1)
      goal.hard.push({
        metric: "exposedPeople",
        operator: "lte",
        value: city.metrics.exposedPeople + 4,
      });
    for (const policy of sources) {
      const localGoal = structuredClone(goal);
      if (policy.name === "undeclared-signal")
        localGoal.actions = ["road.close"];
      let actions: CityAction[] = [];
      let proposalError: string | undefined;
      try {
        actions = (
          await runCityExecutable(policy.source, {
            environment: city,
            goal: localGoal,
          })
        ).actions;
      } catch (e) {
        proposalError = e instanceof Error ? e.message : "proposal failed";
      }
      const cap = cityCapability(localGoal, policy.source, policy.name);
      const earlyStore = new MemoryStateStore();
      await earlyStore.transaction((s) => {
        s.city = structuredClone(city);
        delete s.city.deployment;
      });
      const provider = new TwinEnvironmentProvider(earlyStore);
      const execution = await sandbox.run(
        cap,
        { id: "early-" + index, type: "manual", payload: {} },
        earlyStore,
        undefined,
        {
          kind: "city",
          mode: "FUTURES",
          provider,
          goal: localGoal,
          binding: city.id,
        },
      );
      await earlyStore.transaction((s) => advanceCity(s.city!, 20, false));
      const early = (await provider.observe()).metrics;
      const outcome = await rollout(
        city,
        seed + 17,
        localGoal,
        cap,
        sandbox,
        false,
      );
      const unsafe = Boolean(
        outcome.rollout.error || outcome.rollout.violations.length,
      );
      const brokerDenied = Boolean(
        outcome.rollout.error &&
        /denied|Permission denied|safety gate|Route must|unsafe|Unknown|Shelter/.test(
          outcome.rollout.error,
        ),
      );
      rows.push({
        episode: "policy-episode-" + index,
        split,
        seed,
        scenario,
        policy: policy.name,
        sourceHash: createHash("sha256").update(policy.source).digest("hex"),
        algorithmHash: algorithmHash(policy.source),
        x: policyFeatures(
          city,
          localGoal,
          actions,
          early,
          execution.status !== "success",
        ),
        behavior: behaviorRepresentation(actions, city.metrics, early),
        unsafe: Number(unsafe),
        brokerDenied: Number(brokerDenied),
        loss: outcome.rollout.score,
        degraded: Number(
          unsafe ||
            outcome.rollout.metrics.exposedPeople >
              city.metrics.exposedPeople + 4 ||
            outcome.rollout.metrics.congestion > city.metrics.congestion + 0.15,
        ),
        outcome: outcome.rollout,
        earlyExecution: { status: execution.status, error: execution.error },
        proposalError,
      });
    }
    if (index % 8 === 0) console.log("Policy episodes " + index + "/128");
    index++;
  }
await mkdir("artifacts/ml", { recursive: true });
const encoded = JSON.stringify({
  version: 1,
  horizon: 120,
  earlySeconds: 20,
  episodes: index,
  rows,
  sources: sources.map((s) => ({ name: s.name, source: s.source })),
  createdAt: new Date().toISOString(),
});
await writeFile("artifacts/ml/policy-dataset.json", encoded);
await writeFile(
  "artifacts/ml/policy-dataset-hash.json",
  JSON.stringify({
    hash: createHash("sha256").update(encoded).digest("hex"),
    episodeCount: index,
    rowCount: rows.length,
  }),
);
console.log(
  "Policy data complete: " + rows.length + " actual worker/broker rollouts",
);
