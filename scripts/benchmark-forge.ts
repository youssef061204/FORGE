import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const directory = "artifacts/ml";
await mkdir(directory, { recursive: true });
const python =
  process.env.FORGE_PYTHON ??
  (existsSync(".venv-ml/Scripts/python.exe")
    ? ".venv-ml/Scripts/python.exe"
    : existsSync(".venv-ml/bin/python")
      ? ".venv-ml/bin/python"
      : "python");
const cli = (path: string) => ({
  binary: process.execPath,
  args: ["node_modules/tsx/dist/cli.mjs", path],
});
const py = (path: string) => ({ binary: python, args: ["-u", path] });
const steps = [
  { name: "dataset", ...cli("scripts/ml/generate-dataset.ts") },
  { name: "world", ...py("scripts/ml/train.py") },
  { name: "policy-data", ...cli("scripts/ml/generate-policy-data.ts") },
  { name: "policy", ...py("scripts/ml/train-policy.py") },
  { name: "adaptation-data", ...cli("scripts/ml/generate-adaptation.ts") },
  { name: "adaptation", ...py("scripts/ml/train-adaptation.py") },
  { name: "inference", ...cli("scripts/ml/verify-inference.ts") },
  { name: "control-data", ...cli("scripts/ml/control-benchmark.ts") },
  { name: "rl", ...py("scripts/ml/train-rl.py") },
  {
    name: "control",
    ...cli("scripts/ml/control-benchmark.ts"),
    args: [...cli("scripts/ml/control-benchmark.ts").args, "--evaluate"],
  },
  { name: "cameras", ...cli("scripts/ml/generate-cameras.ts") },
  { name: "multi-agent", ...cli("scripts/ml/multi-agent.ts") },
  { name: "vision", ...py("scripts/ml/train-vision.py") },
  { name: "vision-fixtures", ...py("scripts/ml/verify-vision.py") },
  { name: "vision-parity", ...cli("scripts/ml/verify-vision.ts") },
  { name: "fusion", ...py("scripts/ml/fusion.py") },
  { name: "gpu-input", ...cli("scripts/ml/prepare-gpu.ts") },
  { name: "gpu", ...py("scripts/ml/gpu-futures.py") },
  { name: "allocation", ...cli("scripts/ml/benchmark-allocation.ts") },
  { name: "optimization", ...py("scripts/ml/optimization.py") },
  { name: "safety", ...py("scripts/ml/formal-safety.py") },
  { name: "adversarial", ...cli("scripts/ml/adversarial.ts") },
  { name: "active-learning", ...py("scripts/ml/active-learning.py") },
  { name: "domain-randomization", ...py("scripts/ml/domain-randomization.py") },
  { name: "synthesis", ...cli("scripts/ml/synthesis-benchmark.ts") },
  { name: "external", ...cli("scripts/ml/external-evaluation.ts") },
  { name: "real-map", ...cli("scripts/ml/import-osm.ts") },
  { name: "onnx", ...py("scripts/ml/onnx-benchmark.py") },
  { name: "statistics", ...cli("scripts/ml/statistics.ts") },
  { name: "evidence", ...cli("scripts/ml/export-evidence.ts") },
  { name: "docs", ...cli("scripts/ml/write-docs.ts") },
];
const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");
const ml = process.argv.includes("--ml");
const selected = steps.filter((s) =>
  only
    ? only.includes(s.name)
    : ml
      ? [
          "dataset",
          "world",
          "policy-data",
          "policy",
          "inference",
          "allocation",
          "evidence",
        ].includes(s.name)
      : true,
);
const results: unknown[] = [];
for (const step of selected) {
  const started = performance.now();
  console.log("FORGE benchmark: " + step.name);
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      step.binary,
      ml && step.name === "evidence" ? [...step.args, "--ml"] : step.args,
      {
        stdio: "inherit",
        env: {
          ...process.env,
          OMP_NUM_THREADS: "2",
          OPENBLAS_NUM_THREADS: "2",
          MKL_NUM_THREADS: "2",
          FORGE_RUNTIME_MODE: "fixture",
        },
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  results.push({
    stage: step.name,
    exitCode: code,
    durationMs: Math.round(performance.now() - started),
  });
  await writeFile(
    directory + "/benchmark-run.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        mode: only ? "selected-stages" : ml ? "ml" : "full",
        python,
        results,
      },
      null,
      2,
    ),
  );
  if (code !== 0)
    throw new Error(
      "Benchmark stage failed: " +
        step.name +
        ". Evidence retained; no success claim.",
    );
}
const config = await readFile("scripts/benchmark-forge.ts", "utf8");
await writeFile(
  directory + "/benchmark-config-hash.json",
  JSON.stringify({
    hash: createHash("sha256").update(config).digest("hex"),
    gitCommit: null,
    paidRequestsInDefaultWorkflow: 0,
  }),
);
// The runner writes its last results after the evidence stage. Rebind hashes
// after those final manifests exist so the index cannot contain stale hashes.
await import("./ml/hash-evidence");
