import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { cameraPredict } from "../../src/forge/vision-runtime";
const fixture = JSON.parse(
  await readFile("artifacts/ml/vision-parity.json", "utf8"),
) as { cases: { rgba: number[]; predicted: number[] }[] };
let maximum = 0;
const times = [];
for (const test of fixture.cases) {
  const actual = cameraPredict(test.rgba);
  times.push(actual.durationMs);
  actual.probabilities.forEach((v, i) => {
    const difference = Math.abs(v - test.predicted[i]);
    maximum = Math.max(maximum, difference);
    assert(difference < 1e-5);
  });
}
await writeFile(
  "artifacts/ml/vision-inference.json",
  JSON.stringify(
    {
      passed: true,
      cases: fixture.cases.length,
      maxProbabilityError: maximum,
      actualInferenceMs: times,
    },
    null,
    2,
  ),
);
console.log("Actual CNN Python/TypeScript parity passed", maximum);
