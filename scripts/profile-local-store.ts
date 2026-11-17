import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { LocalStateStore } from "../src/forge/store";
import { stateSchema } from "../src/forge/records";
import { digest } from "../src/forge/hash";

const path = resolve(
  process.argv[2] ?? "artifacts/e2e-state-1791431287014/forge.json",
);
assert(
  path.startsWith(resolve("artifacts") + "/") ||
    path.startsWith(resolve("artifacts") + "\\"),
);
const store = new LocalStateStore(dirname(path));
const first = await store.read();
const baselineMs: number[] = [],
  cachedMs: number[] = [];
for (let i = 0; i < 5; i++) {
  let started = performance.now();
  const baseline = stateSchema.parse(JSON.parse(await readFile(path, "utf8")));
  baselineMs.push(performance.now() - started);
  started = performance.now();
  const cached = await store.read();
  cachedMs.push(performance.now() - started);
  assert.equal(digest(cached), digest(baseline));
  assert.equal(digest(cached), digest(first));
}
const mean = (values: number[]) =>
  values.reduce((s, v) => s + v, 0) / values.length;
const result = {
  passed: true,
  at: new Date().toISOString(),
  inputBytes: (await stat(path)).size,
  inputHash: digest(first),
  repeats: 5,
  baselineMs,
  cachedMs,
  baselineMeanMs: mean(baselineMs),
  cachedMeanMs: mean(cachedMs),
  readSpeedup: mean(baselineMs) / mean(cachedMs),
  scope:
    "Actual LocalStateStore warm read versus prior filesystem/JSON/schema read on one synthetic saved browser fixture; every result digest matches. External changes still require schema validation. Not a full application speedup.",
};
await writeFile(
  "artifacts/local-store-performance.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
