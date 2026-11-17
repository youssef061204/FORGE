import { mkdir, writeFile } from "node:fs/promises";
import {
  createCity,
  controlCity,
  advanceCity,
} from "../../src/forge/city-engine";
import { advanceTerrain } from "../../src/forge/city-terrain";
import { hazardKinds } from "../../src/forge/city-contracts";
const samples = [];
const fieldTimes: number[] = [],
  tickTimes: number[] = [];
for (const [i, kind] of hazardKinds.entries()) {
  const city = createCity(26000000 + i * 371);
  controlCity(city, {
    operation: "hazard.create",
    kind,
    x: 840,
    y: 650,
    intensity: 0.7,
    radius: 240,
  });
  const initial = structuredClone(city);
  for (let t = 0; t < 60; t++) {
    for (const h of city.hazards) h.age += 2;
    const start = performance.now();
    advanceTerrain(city, 2);
    fieldTimes.push(performance.now() - start);
  }
  samples.push({
    kind,
    initial: {
      cells: initial.terrain!.cells,
      weather: initial.weather,
      hazards: initial.hazards,
    },
    expected: city.terrain!.cells,
  });
  const full = structuredClone(initial);
  for (let t = 0; t < 60; t++) {
    const start = performance.now();
    advanceCity(full, 2, false);
    tickTimes.push(performance.now() - start);
  }
}
const mean = (values: number[]) =>
  values.reduce((s, v) => s + v, 0) / values.length;
await mkdir("artifacts/ml", { recursive: true });
await writeFile(
  "artifacts/ml/gpu-input.json",
  JSON.stringify({
    createdAt: new Date().toISOString(),
    samples,
    profile: {
      component: "advanceTerrain",
      fieldMeanMs: mean(fieldTimes),
      fullTickMeanMs: mean(tickTimes),
      measuredSamples: fieldTimes.length,
      estimatedFieldShare: mean(fieldTimes) / mean(tickTimes),
      note: "Separately timed equivalent field work and full ticks; not an instrumented sum of identical executions.",
    },
  }),
);
console.log(
  "Profiled field mean " +
    mean(fieldTimes).toFixed(3) +
    "ms; full tick " +
    mean(tickTimes).toFixed(3) +
    "ms",
);
