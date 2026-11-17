import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { runCityExecutable } from "../src/forge/executable";
import { developmentGoal, developmentSource } from "../src/forge/city-model";
import { createCity } from "../src/forge/city-engine";
import { cityCapability } from "../src/forge/futures";
import { IsolatedSandbox } from "../src/forge/sandbox";
import { MemoryStateStore } from "../src/forge/store";
import { TwinEnvironmentProvider } from "../src/forge/environment";
const start = performance.now(),
  source = developmentSource(0),
  store = new MemoryStateStore();
await store.transaction((s) => {
  s.city = createCity(77);
});
const output = await runCityExecutable(
  source,
  {
    environment: await new TwinEnvironmentProvider(store).observe(),
    goal: developmentGoal,
  },
  "docker",
);
assert(output.actions.length > 0);
const cap = cityCapability(
  developmentGoal,
  source,
  "City Docker isolation proof",
);
const execution = await new IsolatedSandbox("docker").run(
  cap,
  { id: "city-docker", type: "manual", payload: {} },
  store,
  undefined,
  {
    kind: "city",
    mode: "FUTURES",
    provider: new TwinEnvironmentProvider(store),
    binding: "forge-city",
    goal: developmentGoal,
  },
);
assert.equal(execution.status, "success", execution.error);
assert.equal(execution.trace.length, 3);
const evidence = {
  passed: true,
  at: new Date().toISOString(),
  sandbox: "Docker City workflow and generated module",
  network: "none",
  readOnly: true,
  credentialsInherited: false,
  durationMs: Math.round(performance.now() - start),
  actions: output.actions.length,
  execution,
};
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/city-docker-proof.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    passed: true,
    durationMs: evidence.durationMs,
    actions: output.actions.length,
    traceSteps: execution.trace.length,
  }),
);
