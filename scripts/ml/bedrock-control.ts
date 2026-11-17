import { readFile, writeFile } from "node:fs/promises";
import { cityCapability, rollout, summarize } from "../../src/forge/futures";
import { createCity, controlCity } from "../../src/forge/city-engine";
import { IsolatedSandbox } from "../../src/forge/sandbox";
import type { GoalContract } from "../../src/forge/city-contracts";
import { cityActionNames } from "../../src/forge/city-contracts";
const evidence = JSON.parse(
  await readFile("artifacts/ml/program-synthesis.json", "utf8"),
);
const live = evidence.live.find(
  (c: { case: number; kind: string }) => c.case === 0 && c.kind === "goal",
);
if (!live)
  throw new Error(
    "Actual recorded Bedrock traffic compiler output is required",
  );
// Original response contract was schema-validated at generation; benchmark goal is fixed here.
const goal: GoalContract = {
  goal: "Paired traffic benchmark",
  hard: [{ metric: "hospitalPower", operator: "gte", value: 0.9 }],
  objectives: [{ metric: "congestion", direction: "minimize", weight: 1 }],
  actions: [...cityActionNames],
  forbiddenOutcomes: ["Hospital outage"],
  priorities: ["Safety", "Queues"],
  interpretation: "Common frozen benchmark goal",
};
const sandbox = new IsolatedSandbox("process"),
  cases = [];
for (let i = 0; i < 24; i++) {
  const seed = 22587600 + i * 6121,
    city = createCity(seed);
  if (i % 2 === 0) controlCity(city, { operation: "traffic.add", count: 25 });
  if (i % 3 === 0)
    controlCity(city, {
      operation: "hazard.create",
      kind: "traffic",
      x: city.nodes[(i * 7) % 48].x,
      y: city.nodes[(i * 7) % 48].y,
      radius: 180,
      intensity: 0.65,
    });
  const programs = [];
  for (const program of live.programs) {
    const result = await rollout(
      city,
      seed + 171,
      goal,
      cityCapability(goal, program.source, program.name),
      sandbox,
      false,
    );
    programs.push({
      name: program.name,
      sourceHash: program.hash,
      ...result.rollout,
    });
  }
  cases.push({ episode: i, programs });
}
const outcomes = cases.flatMap((c) => c.programs);
await writeFile(
  "artifacts/ml/bedrock-control.json",
  JSON.stringify(
    {
      scope:
        "Actual recorded Bedrock-generated sources, exactly the 24 frozen controller scenes and disturbance seeds from rl.json, common original benchmark goal and manifest. Failures retained; no additional paid requests.",
      evidence: live.evidence,
      cases,
      summary: summarize(outcomes),
      perSource: live.programs.map((p: { hash: string; name: string }) => ({
        name: p.name,
        hash: p.hash,
        summary: summarize(outcomes.filter((o) => o.sourceHash === p.hash)),
      })),
      selection:
        "Sources compared individually. No held-out oracle selection of the best source on each scene.",
    },
    null,
    2,
  ),
);
