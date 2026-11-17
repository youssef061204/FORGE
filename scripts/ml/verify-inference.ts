import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { predictFeatures, modelReady } from "../../src/forge/world-model";
import { featureNames } from "../../src/forge/forecast-features";
import { predictPolicy } from "../../src/forge/policy-model-runtime";
assert(modelReady(), "Trained world model required");
const fixtures = JSON.parse(
  await readFile("artifacts/ml/inference-parity.json", "utf8"),
) as { x: number[][]; y: number[][]; outage: number[]; blocked: number[] };
let maxError = 0,
  maxRiskError = 0;
for (let i = 0; i < fixtures.x.length; i++) {
  assert.equal(fixtures.x[i].length, featureNames.length);
  const actual = predictFeatures(fixtures.x[i]);
  for (let j = 0; j < actual.values.length; j++)
    maxError = Math.max(
      maxError,
      Math.abs(actual.values[j] - fixtures.y[i][j]),
    );
  maxRiskError = Math.max(
    maxRiskError,
    Math.abs(actual.risk.outage - fixtures.outage[i]),
    Math.abs(actual.risk.blocked - fixtures.blocked[i]),
  );
}
assert(maxError < 0.001, "Python/TypeScript forecast mismatch: " + maxError);
assert(
  maxRiskError < 1e-8,
  "Python/TypeScript calibration mismatch: " + maxRiskError,
);
const policyFixtures = JSON.parse(
  await readFile("artifacts/ml/policy-inference-fixtures.json", "utf8"),
) as {
  fixtures: {
    x: number[];
    risk: { unsafe: number; brokerDenied: number; degraded: number };
  }[];
};
let maxPolicyRiskError = 0;
for (const fixture of policyFixtures.fixtures) {
  const prediction = predictPolicy(fixture.x);
  assert(prediction, "Policy inference missing");
  for (const target of ["unsafe", "brokerDenied", "degraded"] as const)
    maxPolicyRiskError = Math.max(
      maxPolicyRiskError,
      Math.abs(prediction[target] - fixture.risk[target]),
    );
}
assert(
  maxPolicyRiskError < 1e-8,
  "Policy ensemble Python/TypeScript mismatch: " + maxPolicyRiskError,
);
await writeFile(
  "artifacts/ml/inference-verification.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      samples: fixtures.x.length,
      features: featureNames.length,
      maxError,
      maxRiskError,
      maxPolicyRiskError,
      policySamples: policyFixtures.fixtures.length,
      passed: true,
    },
    null,
    2,
  ),
);
console.log(
  "Portable inference passed: " +
    fixtures.x.length +
    " samples; maximum error " +
    maxError,
);
