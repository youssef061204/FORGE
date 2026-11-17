import { writeFile, mkdir } from "node:fs/promises";
import { createCity, controlCity } from "../../src/forge/city-engine";
import { developmentGoal, developmentSource } from "../../src/forge/city-model";
import { cityCapability, rollout } from "../../src/forge/futures";
import { TwinEnvironmentProvider } from "../../src/forge/environment";
import { MemoryStateStore } from "../../src/forge/store";
import { IsolatedSandbox } from "../../src/forge/sandbox";
import { cityActionSchema } from "../../src/forge/city-contracts";
import { digest } from "../../src/forge/hash";
await mkdir("artifacts/ml", { recursive: true });
const goal = structuredClone(developmentGoal),
  source = developmentSource(2, true),
  cap = cityCapability(goal, source, "frozen protected policy");
const sandbox = new IsolatedSandbox("process"),
  fuzz = [];
for (let i = 0; i < 300; i++) {
  const city = createCity(38000000 + i * 79),
    hospital = city.buildings.find((b) => b.kind === "hospital")!,
    shelter = city.buildings.find((b) => b.kind === "shelter")!,
    road = city.roads[0],
    store = new MemoryStateStore();
  road.risk = 0.9;
  road.closed = true;
  road.manualClosed = true;
  shelter.mode = "emergency";
  shelter.occupancy = shelter.capacity;
  const tests = [
    { operation: "grid.shed", buildingId: hospital.id, power: 0.1 },
    { operation: "road.open", roadId: road.id },
    {
      operation: "vehicle.route",
      vehicleId: city.vehicles[0].id,
      path: [city.vehicles[0].path[0], "missing-node"],
    },
    {
      operation: "population.route",
      pedestrianId: city.pedestrians[0].id,
      shelterId: shelter.id,
    },
    { operation: "grid.shed", buildingId: "missing-building", power: 1 },
    {
      operation: "signal.set",
      nodeId: city.nodes[0].id,
      phase: "ns",
      seconds: -2,
    },
    {
      operation: "vehicle.dispatch",
      vehicleId: city.vehicles.find((v) => v.kind === "car")!.id,
      destination: hospital.id,
    },
    { operation: "unsupported.secret", payload: "prompt injection" },
    { operation: "grid.shed", buildingId: hospital.id, power: 1.1 },
    { operation: "road.close", roadId: "missing-road" },
  ];
  await store.transaction((s) => {
    s.city = city;
  });
  const before = digest(await store.read());
  let blocked = false,
    error = "";
  try {
    const action = cityActionSchema.parse(tests[i % tests.length]);
    await new TwinEnvironmentProvider(store).execute([action], {
      capability: cap,
      digest: digest(cap),
      binding: city.id,
      mode: "FUTURES",
    });
  } catch (e) {
    blocked = true;
    error = e instanceof Error ? e.message : String(e);
  }
  fuzz.push({
    case: i,
    seed: city.seed,
    category: i % tests.length,
    blocked,
    error,
    atomic: digest(await store.read()) === before,
  });
}
if (fuzz.some((c) => !c.blocked || !c.atomic))
  throw new Error("Adversarial broker check escaped a guard");
await writeFile(
  "artifacts/ml/red-team.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      fuzz,
      blocked: fuzz.filter((c) => c.blocked).length,
      scope:
        "300 actual schema/broker/physical guard attempts, ten repeated categories; these are not 300 independent prompt injections.",
    },
    null,
    2,
  ),
);
type Genome = {
  intensity: number;
  radius: number;
  node: number;
  rain: number;
  wind: number;
  kind: "flood" | "wildfire" | "earthquake" | "blackout";
};
let rng = 402;
const random = () => {
  rng = (1664525 * rng + 1013904223) >>> 0;
  return rng / 4294967296;
};
const sample = (): Genome => ({
  intensity: 0.4 + random() * 0.6,
  radius: 150 + random() * 300,
  node: Math.floor(random() * 48),
  rain: random(),
  wind: random(),
  kind: (["flood", "wildfire", "earthquake", "blackout"] as const)[
    Math.floor(random() * 4)
  ],
});
const search: Record<string, unknown[]> = { random: [], evolutionary: [] };
for (const mode of ["random", "evolutionary"]) {
  let population = Array.from({ length: 12 }, sample),
    elites: Genome[] = [];
  for (let generation = 0; generation < 4; generation++) {
    const scores: { genome: Genome; fitness: number }[] = [];
    for (let j = 0; j < 12; j++) {
      const genome = population[j],
        city = createCity(39500000 + generation * 151 + j),
        node = city.nodes[genome.node];
      controlCity(city, {
        operation: "weather.set",
        rain: genome.rain,
        wind: genome.wind,
      });
      controlCity(city, {
        operation: "hazard.create",
        kind: genome.kind,
        x: node.x,
        y: node.y,
        intensity: genome.intensity,
        radius: genome.radius,
      });
      const result = await rollout(
        city,
        40500000 + generation * 151 + j,
        goal,
        cap,
        sandbox,
        false,
      );
      const fitness =
        result.rollout.score +
        result.rollout.violations.length * 2 +
        Number(Boolean(result.rollout.error)) * 2;
      scores.push({ genome, fitness });
      search[mode].push({
        generation,
        case: j,
        genome,
        fitness,
        ...result.rollout,
      });
    }
    elites = scores
      .sort((a, b) => b.fitness - a.fitness)
      .slice(0, 3)
      .map((s) => s.genome);
    population = Array.from({ length: 12 }, (_, j) =>
      mode === "random"
        ? sample()
        : {
            ...elites[j % 3],
            node: Math.floor(random() * 48),
            intensity: Math.max(
              0.1,
              Math.min(1, elites[j % 3].intensity + (random() - 0.5) * 0.3),
            ),
            radius: Math.max(
              80,
              Math.min(450, elites[j % 3].radius + (random() - 0.5) * 150),
            ),
          },
    );
    console.log(mode + " adversary generation " + generation);
  }
}
await writeFile(
  "artifacts/ml/learned-adversary.json",
  JSON.stringify(
    {
      algorithm:
        "Measured evolutionary search, 12 genomes × 4 generations, selection by actual failure/loss; no neural adversary claim",
      seed: 402,
      budgetPerMethod: 48,
      search,
    },
    null,
    2,
  ),
);
const causal = [];
for (let e = 0; e < 6; e++) {
  const city = createCity(41600000 + e * 13),
    seed = 41700000 + e * 17;
  controlCity(city, {
    operation: "hazard.create",
    kind: e % 2 ? "flood" : "wildfire",
    x: 900,
    y: 800,
    radius: 250,
    intensity: 0.65,
  });
  const full = await rollout(city, seed, goal, cap, sandbox, false);
  for (const operation of ["grid.shed", "signal.set", "population.route"]) {
    const ablated = await rollout(city, seed, goal, cap, sandbox, false, [
      operation,
    ]);
    causal.push({
      episode: e,
      seed,
      operation,
      full: full.rollout,
      ablated: ablated.rollout,
      scoreDifference: ablated.rollout.score - full.rollout.score,
    });
  }
}
const counterfactual = [];
for (let i = 0; i <= 10; i++) {
  const city = createCity(42200001),
    h = city.buildings.find((b) => b.kind === "hospital")!;
  h.damage = i / 10;
  controlCity(city, {
    operation: "hazard.create",
    kind: "blackout",
    x: h.x,
    y: h.y,
    radius: 120,
    intensity: 0.9,
  });
  const result = await rollout(city, 42201111, goal, cap, sandbox, false);
  counterfactual.push({
    changedVariable: "initial hospital damage",
    value: i / 10,
    ...result.rollout,
  });
}
await writeFile(
  "artifacts/ml/causal.json",
  JSON.stringify(
    {
      scope:
        "Paired intervention in the digital twin; no real-world causal identification",
      causal,
      counterfactual,
      smallestObservedFailureDamage:
        counterfactual.find((c) => c.violations.length)?.value ?? null,
      resolution: 0.1,
      limitation:
        "Smallest measured grid point, not a globally minimal intervention",
    },
    null,
    2,
  ),
);
