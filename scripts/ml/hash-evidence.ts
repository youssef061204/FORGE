import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function hashEvidence() {
  const artifacts = [],
    sources = [];
  const sha = (content: Uint8Array) =>
    createHash("sha256").update(content).digest("hex");
  for (const name of await readdir("artifacts/ml")) {
    if (!/\.(json|gz|onnx|pt)$/.test(name) || name === "evidence-index.json")
      continue;
    const path = "artifacts/ml/" + name,
      content = await readFile(path);
    artifacts.push({ path, sha256: sha(content), bytes: content.length });
  }
  for (const directory of ["scripts/ml", "src/forge", "src/forge/maps"]) {
    for (const name of await readdir(directory)) {
      if (!/\.(py|ts|json|txt)$/.test(name)) continue;
      const path = directory + "/" + name;
      sources.push({ path, sha256: sha(await readFile(path)) });
    }
  }
  await writeFile(
    "artifacts/ml/evidence-index.json",
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        gitCommit: null,
        sourceScope:
          "Current source, serialized learned models, map geometry and dependency pins. Dataset manifests retain the frozen engine/feature source hashes used for collection; subsequent regression corrections are documented separately.",
        artifacts,
        sources,
      },
      null,
      2,
    ),
  );
}
await hashEvidence();
