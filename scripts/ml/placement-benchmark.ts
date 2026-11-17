import { writeFile } from "node:fs/promises";
import { createCity, controlCity } from "../../src/forge/city-engine";
import { developmentGoal } from "../../src/forge/city-model";
import {
  placementSource,
  type PlacementKind,
} from "../../src/forge/resource-placement";
import { cityCapability, rollout, summarize } from "../../src/forge/futures";
import { compileExecutable } from "../../src/forge/executable";
import { IsolatedSandbox } from "../../src/forge/sandbox";
const goal = structuredClone(developmentGoal);
goal.goal = "Pre-position responders to reduce incident response delay";
goal.interpretation =
  "Bounded three-facility graph-distance placement; live state changes only after owner approval";
goal.actions = ["vehicle.route", "vehicle.dispatch"];
goal.objectives = [
  { metric: "responseSeconds", direction: "minimize", weight: 1 },
];
const kinds: PlacementKind[] = ["random", "demand", "optimization", "learned"];
const sources = Object.fromEntries(kinds.map((k) => [k, placementSource(k)]));
const sandbox = new IsolatedSandbox("process");
const by: Record<string, Parameters<typeof summarize>[0]> = Object.fromEntries(
  kinds.map((k) => [k, []]),
);
const cases = [];
for (let i = 0; i < 24; i++) {
  const city = createCity(62487000 + i * 283),
    seed = 62496000 + i * 479;
  controlCity(city, {
    operation: "hazard.create",
    kind: i % 2 ? "wildfire" : "flood",
    x: city.nodes[(i * 7) % 48].x,
    y: city.nodes[(i * 7) % 48].y,
    radius: 180,
    intensity: 0.55,
  });
  const results = [];
  for (const kind of kinds) {
    const source = sources[kind];
    compileExecutable(source, "city/v1");
    const r = await rollout(
      city,
      seed,
      goal,
      cityCapability(goal, source, kind + " placement"),
      sandbox,
      false,
    );
    by[kind].push(r.rollout);
    results.push({ kind, ...r.rollout });
  }
  cases.push({ episode: i, seed, results });
}
const differences = cases.map(
  (c) =>
    c.results.find((r) => r.kind === "optimization")!.metrics.responseSeconds -
    c.results.find((r) => r.kind === "learned")!.metrics.responseSeconds,
);
let seed = 9049;
const random = () => {
  seed = (1664525 * seed + 1013904223) >>> 0;
  return seed / 4294967296;
};
const boot = Array.from(
  { length: 1000 },
  () =>
    differences.reduce(
      (s) => s + differences[Math.floor(random() * differences.length)],
      0,
    ) / differences.length,
).sort((a, b) => a - b);
await writeFile(
  "artifacts/ml/resource-placement.json",
  JSON.stringify(
    {
      scope:
        "Real isolated-worker/broker execution on 24 paired full City scenes. Learned +60-second demand prioritizes exact enumeration of three locations among twelve graph sites, using safe graph routes. All strategies share the same tactical dispatch phase at simulation seconds modulo 120 >=80. Actual incident response and every failure are retained.",
      episodes: 24,
      kinds,
      sources,
      cases,
      summaries: Object.fromEntries(kinds.map((k) => [k, summarize(by[k])])),
      learnedResponseDeltaVsOptimization: {
        mean: differences.reduce((s, n) => s + n, 0) / differences.length,
        paired95CI: [boot[25], boot[974]],
      },
      limitations: [
        "Bounded three-site hop-distance surrogate; not global optimal emergency planning.",
        "Only vehicle placement is modeled; mobile generators and shelter supplies have no movement actuators.",
      ],
    },
    null,
    2,
  ),
);
console.log("Resource placement: 24 paired broker evaluations retained");
