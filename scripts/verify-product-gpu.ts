import { readFile, mkdir, writeFile } from "node:fs/promises";
const directory = "artifacts/product";
await mkdir(directory, { recursive: true });
// Keep bridge authentication inside this process; print aggregate evidence only.
const settings = Object.fromEntries(
  (await readFile(".env.gpu", "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);
const url = new URL(settings.FORGE_GPU_BRIDGE_URL);
if (url.hostname === "host.docker.internal") url.hostname = "127.0.0.1";
const headers = {
  Authorization: "Bearer " + settings.FORGE_GPU_BRIDGE_TOKEN,
  "Content-Type": "application/json",
};
try {
  const health = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(5000),
  });
  const status = await health.json();
  if (!health.ok || status.cuda !== true)
    throw new Error("Local bridge reports CUDA unavailable");
  const input = JSON.parse(
    await readFile("artifacts/ml/gpu-input.json", "utf8"),
  );
  const sample = input.samples[0].initial;
  const rows = [];
  for (const batch of [100, 1000, 2048]) {
    const response = await fetch(new URL("/fields", url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        terrain: { cells: sample.cells },
        weather: sample.weather,
        hazards: sample.hazards,
        batch,
        seed: 904,
        observedFieldHash: "current-reference-input",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || result.provider !== "CUDA / PyTorch")
      throw new Error("Local CUDA computation did not succeed");
    rows.push(result);
  }
  const report = {
    at: new Date().toISOString(),
    status: "VERIFIED",
    scope:
      "Existing read-only local CUDA bridge; one request per batch. Not the 31-stage GPU benchmark, CPU speedup, or whole Twin acceleration.",
    measurements: rows,
  };
  await writeFile(
    directory + "/gpu-bridge-current.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch {
  const report = {
    at: new Date().toISOString(),
    status: "UNVERIFIED",
    reason:
      "Existing local CUDA bridge was unavailable or could not execute. No CPU fallback or historical GPU success claim.",
    requestsPaid: 0,
  };
  await writeFile(
    directory + "/gpu-bridge-current.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  process.exitCode = 1;
}
