/**
 * npm run tapes:record — replay every sample request through the live Crucible
 * on this machine's local model and save the event streams as RECORDED tapes
 * in public/tapes/. Without a model, writes SCRIPTED tapes from the scripted
 * stand-in instead, labeled as such. Never pulls a model.
 *
 *   npx tsx scripts/record-tapes.ts [--only=orders,contacts] [--scripted]
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { BuildEvent, BuildEventBody, Tape } from "../src/core/events/types";
import { runCrucible } from "../src/core/synth/crucible";
import { ScriptedTransport, type ModelTransport } from "../src/core/synth/transport";
import { chooseModel, discoverOllama, OllamaTransport } from "../src/server/models/ollama";
import { scriptedResponder } from "../src/server/models";
import { lowerAndVerify } from "../src/server/verify";
import { SAMPLES } from "../src/showcase/samples";

const args = new Map(process.argv.slice(2).map((a) => (a.includes("=") ? (a.split(/=(.*)/s).slice(0, 2) as [string, string]) : [a, "true"])));
const only = args.get("--only")?.split(",");
const hardware = process.env.FORGE_HARDWARE ?? "NVIDIA GeForce RTX 5050 Laptop GPU";

async function transport(): Promise<ModelTransport> {
  if (args.has("--scripted")) return new ScriptedTransport(scriptedResponder, "scripted", 3);
  const found = await discoverOllama(process.env.FORGE_OLLAMA_URL);
  const model = found && chooseModel(found.models, process.env.FORGE_MODEL);
  if (!found || !model) {
    console.log("No local model: recording SCRIPTED tapes instead.");
    return new ScriptedTransport(scriptedResponder, "scripted", 3);
  }
  return new OllamaTransport(found.url, model);
}

async function main() {
  const t = await transport();
  const commit = execSync("git rev-parse --short HEAD").toString().trim();
  mkdirSync("public/tapes", { recursive: true });
  const indexPath = "public/tapes/index.json";
  const index: { name: string; sample: string; level: number; request: string; provenance: string; model?: string; outcome: string; recordedAt: string }[] = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : [];
  for (const s of SAMPLES) {
    if (only && !only.includes(s.id)) continue;
    for (const r of s.requests) {
      const name = `${s.id}-${r.level}`;
      const events: BuildEvent[] = [];
      let seq = 0;
      const t0 = Date.now();
      const emit = (body: BuildEventBody) => events.push({ buildId: `tape-${name}`, seq: seq++, atMs: Date.now() - t0, ...body } as BuildEvent);
      const recordedAt = new Date().toISOString();
      const provenance = t.provenance === "live" ? "recorded" : "scripted";
      const result = await runCrucible(r.text, [{ name: s.file.name, format: s.file.format, text: s.file.text }], {
        transport: t,
        emit,
        drafts: 5,
        now: "2026-11-17T12:00:00.000Z",
        provenance,
        hardware: provenance === "recorded" ? hardware : undefined,
        lower: (recipe, plan) => lowerAndVerify(recipe, plan).lowered,
        verify: async (recipe, plan, inputs) => lowerAndVerify(recipe, plan, inputs).checks,
      });
      for (const e of events) if (e.t === "build.started") Object.assign(e, { recordedAt: provenance === "recorded" ? recordedAt : undefined });
      const tape: Tape = {
        format: "forge-tape/1",
        id: name,
        title: `${s.title}: ${r.text}`,
        provenance,
        model: t.model,
        hardware: provenance === "recorded" ? hardware : undefined,
        recordedAt,
        commit,
        request: r.text,
        files: [{ slot: result.files[0]?.slot ?? s.id, name: s.file.name, format: s.file.format, text: s.file.text }],
        events,
      };
      writeFileSync(`public/tapes/${name}.json`, JSON.stringify(tape) + "\n");
      const entry = { name, sample: s.id, level: r.level, request: r.text, provenance, model: t.model, outcome: result.outcome, recordedAt };
      const i = index.findIndex((x) => x.name === name);
      if (i >= 0) index[i] = entry;
      else index.push(entry);
      console.log(`${name}: ${result.outcome} in ${(result.ms / 1000).toFixed(1)} s${result.winner ? ` · ${result.winner.agreement}` : ""}`);
    }
  }
  index.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
