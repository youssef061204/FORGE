/** Runs every Safety Lab attack and saves the results for the showcase (public/safety.json). */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { ATTACKS, LAYERS, runAttack } from "../src/server/safety/attacks";

const results = [];
for (const a of ATTACKS) {
  const r = await runAttack(a.id);
  results.push({ id: a.id, title: a.title, story: a.story, payload: a.payload, ...r });
  console.log(`${r.blocked ? "blocked" : "NOT BLOCKED"}  ${a.id}  (${r.layer}, ${r.ms.toFixed(0)} ms)`);
}
writeFileSync(
  "public/safety.json",
  JSON.stringify({ recordedAt: new Date().toISOString(), commit: execSync("git rev-parse --short HEAD").toString().trim(), layers: LAYERS, results }, null, 2) + "\n",
);
process.exit(results.every((r) => r.blocked) ? 0 : 1);
