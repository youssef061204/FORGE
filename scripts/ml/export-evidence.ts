import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const path = "artifacts/ml";
async function get(name: string) {
  return JSON.parse(await readFile(path + "/" + name, "utf8"));
}
async function optionalEvidence(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
const subsystem = (name: string) =>
  process.argv.includes("--ml")
    ? optionalEvidence(path + "/" + name)
    : get(name);
const dataset = await get("dataset.json"),
  metrics = await get("metrics.json"),
  shift = await get("shift-metrics.json"),
  gpu = await subsystem("gpu-futures.json"),
  futures = await get("futures-benchmark.json"),
  vision = await subsystem("vision.json"),
  rl = await subsystem("rl.json"),
  registry = await subsystem("model-registry.json"),
  synthesis = await subsystem("program-synthesis.json");
const held = metrics.results.heldout,
  sha = (text: string | Uint8Array) =>
    createHash("sha256").update(text).digest("hex");
for (const [name, value] of Object.entries({
  "splits.json": {
    datasetHash: dataset.datasetHash,
    splitHash: dataset.splitHash,
    splits: dataset.splits ?? dataset.episodes ?? dataset.config.splitCounts,
    rule: "Whole episodes split before training",
  },
  "world-model.json": {
    provenance: metrics.provenance,
    results: held,
    scope:
      "Synthetic Northbank; measured horizon-specific and baseline comparisons",
  },
  "graph-model.json": {
    provenance: metrics.provenance,
    shared: held.regression["graph-shared-neural"],
    temporal: held.regression["temporal-neural"],
    independent: held.regression["independent-neural"],
    scope:
      "One-hop mean-aggregation GraphSAGE-style features, supervised shared MLP, no learned message-passing stack claim",
  },
  "anomaly.json": {
    provenance: metrics.provenance,
    heldout: held.anomaly,
    shift: shift.results.shift.anomaly,
    compositional: shift.results.compositional.anomaly,
    scope:
      "Controlled synthetic corruption families, not real compromise detection",
  },
  "ood.json": {
    provenance: metrics.provenance,
    heldout: held.ood,
    shift: shift.results.shift.ood,
    compositional: shift.results.compositional.ood,
  },
  "calibration.json": {
    provenance: metrics.provenance,
    risk: held.risk,
    uncertainty: held.uncertainty,
    method:
      "Validation-only isotonic risk calibration and marginal residual intervals",
  },
  "shift.json": shift,
  "performance.json": {
    createdAt: new Date().toISOString(),
    fieldProfile: gpu?.profile ?? "UNVERIFIED",
    gpu: gpu?.benchmarks ?? "UNVERIFIED",
    sandbox: rl?.durationMs ?? null,
    scope:
      "Recorded benchmark timings; browser frame and HTTP timings are separate measured artifacts",
  },
  "system-benchmark.json": {
    adaptive: futures,
    controllers: rl?.summaries ?? "UNVERIFIED",
    gpu,
    modelRegistry: registry,
  },
})) {
  await writeFile(path + "/" + name, JSON.stringify(value, null, 2));
}
const total = (mode: string) =>
  futures.cases.reduce(
    (s: number, c: { results: Record<string, { actualTests: number }> }) =>
      s + c.results[mode].actualTests,
    0,
  );
const gpuLarge = gpu?.benchmarks.find(
  (b: { batch: number }) => b.batch === 1024,
);
const recordedCity = await optionalEvidence(
  "artifacts/bedrock-city-proof.json",
);
const recordedCapability = await optionalEvidence(
  "artifacts/bedrock-proof.json",
);
const summary = {
  createdAt: new Date().toISOString(),
  dataset: {
    episodes: dataset.config.episodes,
    hash: dataset.datasetHash,
    splitHash: dataset.splitHash,
    splitCounts: dataset.config.splitCounts,
  },
  forecasting: {
    selected: held.regression.selected,
    persistence: held.regression.persistence,
    horizons: held.byHorizon,
    risk: held.risk,
    uncertainty: held.uncertainty,
  },
  graph: {
    queueSharedMAE: held.regression["graph-shared-neural"].queue.mae,
    queueTemporalMAE: held.regression["temporal-neural"].queue.mae,
    queueIndependentMAE: held.regression["independent-neural"].queue.mae,
  },
  adaptive: {
    episodes: futures.episodes,
    winnerAgreement: futures.winnerAgreement,
    unsafeMisses: futures.unsafeMisses,
    actualTests: total("adaptive"),
    exhaustiveTests: total("exhaustive"),
    savedFraction: 1 - total("adaptive") / total("exhaustive"),
  },
  controllers: {
    episodes: rl?.heldoutScenarios ?? 0,
    summaries: rl?.summaries ?? "UNVERIFIED",
  },
  placement: {
    training: await subsystem("placement-training.json"),
    benchmark: {
      ...(await subsystem("resource-placement.json")),
      cases: undefined,
      sources: undefined,
    },
  },
  perception: {
    heldout: vision?.metrics.heldout ?? "UNVERIFIED",
    device: vision?.device ?? null,
    datasetHash: vision?.datasetHash ?? null,
  },
  gpu: {
    gpu: gpu?.gpu ?? null,
    parity: gpu?.parity ?? "UNVERIFIED",
    component: gpu?.component ?? "UNVERIFIED",
    largeBatch: gpuLarge,
  },
  adaptation: registry,
  formal: await subsystem("formal-safety.json"),
  synthesis: {
    localCases: synthesis?.local.length ?? 0,
    liveCases: synthesis?.live.length ?? 0,
    scope: synthesis?.localScope ?? "UNVERIFIED",
    livePrograms: synthesis?.live.reduce(
      (s: number, c: { programs?: { execution: boolean }[] }) =>
        s + (c.programs?.length ?? 0),
      0,
    ),
    liveExecutingPrograms: synthesis?.live.reduce(
      (s: number, c: { programs?: { execution: boolean }[] }) =>
        s + (c.programs?.filter((p) => p.execution).length ?? 0),
      0,
    ),
  },
  external: {
    ...(await subsystem("external-eval.json")),
    predictions: undefined,
  },
  map: await subsystem("real-map.json"),
  onnx: await subsystem("onnx.json"),
  recordedBedrock: {
    scope:
      "Recorded successful real compiler calls; the current default runtime remains fixture",
    city: recordedCity?.passed ? recordedCity.providerEvidence : [],
    capability: recordedCapability?.passed
      ? {
          provider: recordedCapability.provider,
          profile: recordedCapability.profile,
          region: recordedCapability.region,
          modelId: recordedCapability.modelId,
          schemaValidationPassed: recordedCapability.schemaValidationPassed,
          requests: recordedCapability.requests,
        }
      : null,
  },
  limitations: [
    "CUDA accelerates hazard fields only; worker/broker and complete City remain CPU.",
    "No real disaster safety or real-camera validity claim.",
    "Native Alexa+ preview and real Google Calendar writes remain unverified.",
    "One actual Bedrock model configured; no multi-model routing or fabricated price estimate.",
    "The camera congestion head failed held-out testing. Adaptive winner agreement is empirical, not a guarantee.",
  ],
};
await writeFile(
  "src/forge/research-evidence.json",
  JSON.stringify(summary, null, 2),
);
const hashes = [];
const sourceHashes = [];
for (const directory of ["scripts/ml", "src/forge"]) {
  for (const name of await readdir(directory)) {
    if (!/\.(py|ts)$/.test(name)) continue;
    const content = await readFile(directory + "/" + name);
    sourceHashes.push({ path: directory + "/" + name, sha256: sha(content) });
  }
}
for (const name of await readdir(path)) {
  if (/\.(json|gz|onnx|pt)$/.test(name) && name !== "evidence-index.json") {
    const content = await readFile(path + "/" + name);
    hashes.push({
      path: path + "/" + name,
      sha256: sha(content),
      bytes: content.length,
    });
  }
}
await writeFile(
  path + "/evidence-index.json",
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      gitCommit: null,
      artifacts: hashes,
      sources: sourceHashes,
    },
    null,
    2,
  ),
);
console.log("Consolidated measured evidence exported");
