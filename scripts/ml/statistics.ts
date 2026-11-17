import { readFile, writeFile } from "node:fs/promises";
let seed = 6202;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const mean = (values: number[]) =>
  values.reduce((s, v) => s + v, 0) / values.length;
function interval(values: number[]) {
  const samples = Array.from({ length: 1000 }, () =>
    mean(
      Array.from(
        { length: values.length },
        () => values[Math.floor(rnd() * values.length)],
      ),
    ),
  ).sort((a, b) => a - b);
  return {
    mean: mean(values),
    ci95: [samples[24], samples[974]],
    episodes: values.length,
    bootstrapReplicates: 1000,
  };
}
const rl = JSON.parse(await readFile("artifacts/ml/rl.json", "utf8")) as {
  cases: { results: { controller: string; score: number }[] }[];
};
const deltas = Object.fromEntries(
  ["pressure", "optimizer", "rl", "hybrid", "generated-fixture"].map((name) => [
    name,
    interval(
      rl.cases.map(
        (c) =>
          c.results.find((r) => r.controller === name)!.score -
          c.results.find((r) => r.controller === "fixed")!.score,
      ),
    ),
  ]),
);
const allocation = JSON.parse(
  await readFile("artifacts/ml/futures-benchmark.json", "utf8"),
) as {
  cases: {
    results: Record<string, { durationMs: number; actualTests: number }>;
  }[];
};
const wall = allocation.cases.map(
    (c) => c.results.adaptive.durationMs / c.results.exhaustive.durationMs,
  ),
  tests = allocation.cases.map(
    (c) => c.results.adaptive.actualTests / c.results.exhaustive.actualTests,
  );
await writeFile(
  "artifacts/ml/statistics.json",
  JSON.stringify(
    {
      method:
        "Paired whole-episode bootstrap, 1,000 resamples; seed 6202; no frame-level random split",
      controllerScoreDeltaVsFixed: deltas,
      adaptiveWallRatio: interval(wall),
      adaptiveTestsRatio: interval(tests),
    },
    null,
    2,
  ),
);
