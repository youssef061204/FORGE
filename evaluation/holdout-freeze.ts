/**
 * Records the source freeze before the sealed holdout is opened:
 * commit, tree hash, time and the holdout's content seal. Requires a clean tree.
 *
 *   npx tsx evaluation/holdout-freeze.ts
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

if (execSync("git status --porcelain").toString().trim()) {
  console.error("Commit everything first: the freeze must name an exact, clean source tree.");
  process.exit(1);
}
const manifest = JSON.parse(readFileSync("evaluation/core-holdout-2026-11-12/manifest.json", "utf8"));
const record = {
  frozenAt: new Date().toISOString(),
  commit: execSync("git rev-parse HEAD").toString().trim(),
  tree: execSync("git rev-parse HEAD^{tree}").toString().trim(),
  srcTree: execSync("git rev-parse HEAD:src").toString().trim(),
  evaluationRunner: execSync("git rev-parse HEAD:evaluation/holdout-capture.ts").toString().trim(),
  holdoutSealSha256: manifest.contentSealSha256,
  contentSealSha256: manifest.contentSealSha256,
  notes: "FORGE 2 source frozen before opening missions.sealed.jsonl, expected.sealed.jsonl, recorded-solutions.sealed.jsonl and author-sealed.cjs.",
};
writeFileSync("evaluation/results/holdout-freeze.json", JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
