/**
 * Sealed holdout, phase A: capture. Runs every mission through the frozen
 * FORGE 2 pipeline and records what it did, WITHOUT opening the oracle
 * (expected.sealed.jsonl), the authored recordings or the authoring script.
 *
 *   npx tsx evaluation/holdout-capture.ts --freeze=evaluation/results/holdout-freeze.json
 *
 * Adaptation to FORGE 2 (see docs/EVALUATION.md):
 * - Fixture resources are read generically from their handlers. Documents
 *   ({name, text}) become input files; other read results become JSON files
 *   named <connector>-<operation>.json. FORGE 2 reads files; it has no
 *   connector-read path, so this is how fixture data reaches it.
 * - FORGE 2 never writes to connectors. Its only effects are output files,
 *   committed through the broker. Each winner is installed in a scratch
 *   store and run twice with the same event key to measure duplicate writes.
 * - Installed legacy programs, scheduler ticks and program state have no
 *   counterpart; their predicates are scored as not applicable in phase B.
 * No code here branches on a mission id, family or wording.
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildEvent, BuildEventBody } from "../src/core/events/types";
import { defaultGrants, passportFor } from "../src/core/contracts/passport";
import { runCrucible, recipeHash } from "../src/core/synth/crucible";
import { Broker } from "../src/server/broker/broker";
import { chooseModel, discoverOllama, OllamaTransport } from "../src/server/models/ollama";
import { SandboxPool } from "../src/server/sandbox/pool";
import { openDatabase } from "../src/server/store/db";
import { Repo } from "../src/server/store/repo";
import { lowerAndVerify } from "../src/server/verify";

const DIR = "evaluation/core-holdout-2026-11-12";
const args = new Map(process.argv.slice(2).map((a) => (a.includes("=") ? (a.split(/=(.*)/s).slice(0, 2) as [string, string]) : [a, "true"])));

type Handler = { kind: string; value?: unknown; collection?: string; resultKey?: string; constants?: Record<string, unknown> };
type Op = { id: string; kind: "read" | "write"; name: string };
type Resource = { descriptor: { id: string; name: string; status: string; operations: Op[] }; collections: Record<string, unknown[]>; handlers: Record<string, Handler> };
type Mission = { id: string; family: string; request: string; now: string; resources: Resource[]; installedPrograms: unknown[]; schedulerTicks: unknown[]; repeatEvent: boolean; conversation: { role: string; text: string }[] };

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function isDoc(v: unknown): v is { name: string; text: string; format?: string } {
  return !!v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" && typeof (v as { text?: unknown }).text === "string" && /\.[a-z]{2,5}$/i.test((v as { name: string }).name);
}
function findDocs(v: unknown, out: { name: string; text: string }[], depth = 0) {
  if (depth > 5 || !v || typeof v !== "object") return;
  if (isDoc(v)) out.push({ name: v.name, text: v.text });
  for (const x of Array.isArray(v) ? v : Object.values(v)) findDocs(x, out, depth + 1);
}

/** Fixture data reaches FORGE 2 as files: documents as themselves, other reads as JSON. */
function filesFor(m: Mission): { name: string; text: string }[] {
  const files: { name: string; text: string }[] = [];
  for (const r of m.resources) {
    if (r.descriptor.status !== "connected") continue;
    for (const op of r.descriptor.operations) {
      if (op.kind !== "read") continue;
      const h = r.handlers[op.id];
      if (!h) continue;
      const data = h.kind === "constant" ? h.value : h.kind === "list" ? { [h.resultKey ?? "items"]: r.collections[h.collection ?? ""] ?? [], ...(h.constants ?? {}) } : undefined;
      if (data === undefined) continue;
      const docs: { name: string; text: string }[] = [];
      findDocs(data, docs);
      if (docs.length) files.push(...docs);
      else files.push({ name: `${r.descriptor.id}-${op.id.split(".").pop()}.json`.replace(/[^\w.-]+/g, "_"), text: JSON.stringify(data) });
    }
    // Documents may also sit directly in collections without a read handler.
    for (const rows of Object.values(r.collections)) {
      const docs: { name: string; text: string }[] = [];
      findDocs(rows, docs);
      for (const d of docs) if (!files.some((f) => f.name === d.name)) files.push(d);
    }
  }
  const seen = new Set<string>();
  return files.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true))).slice(0, 8);
}

async function main() {
  const freezePath = args.get("--freeze");
  if (!freezePath) throw new Error("Refusing to open the sealed corpus without --freeze=<source freeze record>.");
  const freeze = JSON.parse(readFileSync(freezePath, "utf8"));
  const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
  if (freeze.contentSealSha256 !== manifest.contentSealSha256) throw new Error("Freeze record does not name this holdout seal.");
  for (const f of manifest.files) if (sha(readFileSync(join(DIR, f.path))) !== f.sha256) throw new Error(`Seal broken: ${f.path}`);
  const head = execSync("git rev-parse HEAD").toString().trim();
  // Later commits may add docs or results, but the product source must be the frozen one.
  if (execSync("git rev-parse HEAD:src").toString().trim() !== freeze.srcTree) throw new Error("src/ differs from the frozen source tree.");
  if (execSync("git status --porcelain src evaluation/holdout-capture.ts").toString().trim()) throw new Error("Uncommitted changes in src/ since the freeze.");

  const found = await discoverOllama(process.env.FORGE_OLLAMA_URL);
  const model = found && chooseModel(found.models, process.env.FORGE_MODEL);
  if (!found || !model) throw new Error("No local model: the holdout needs fresh local inference.");
  const transport = new OllamaTransport(found.url, model);
  const missions = readFileSync(join(DIR, "missions.sealed.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Mission);
  const out = join("evaluation", "results", `${new Date().toISOString().slice(0, 10)}-${head.slice(0, 7)}-holdout`);
  mkdirSync(join(out, "tapes"), { recursive: true });
  const captured = join(out, "captured.jsonl");
  writeFileSync(captured, "");
  writeFileSync(join(out, "run.json"), JSON.stringify({ startedAt: new Date().toISOString(), commit: head, freeze, model, hardware: process.env.FORGE_HARDWARE ?? "NVIDIA GeForce RTX 5050 Laptop GPU (8 GB)", missions: missions.length, oracleOpened: false }, null, 2) + "\n");
  const pool = new SandboxPool(1);
  for (const m of missions) {
    const events: BuildEvent[] = [];
    let seq = 0;
    const t0 = Date.now();
    const emit = (b: BuildEventBody) => events.push({ buildId: m.id, seq: seq++, atMs: Date.now() - t0, ...b } as BuildEvent);
    const files = filesFor(m);
    const context = m.conversation.length ? `${m.conversation.map((c) => `${c.role}: ${c.text}`).join("\n")}\n\n` : "";
    const record: Record<string, unknown> = { id: m.id, filesGiven: files.map((f) => f.name), installedPrograms: m.installedPrograms.length, schedulerTicks: m.schedulerTicks.length };
    try {
      const result = await runCrucible(`${context}${m.request}`, files.map((f) => ({ name: f.name, text: f.text })), {
        transport,
        emit,
        drafts: 5,
        now: m.now,
        provenance: "live",
        lower: (recipe, plan) => lowerAndVerify(recipe, plan).lowered,
        verify: async (recipe, plan, inputs) => lowerAndVerify(recipe, plan, inputs, m.now).checks,
      });
      const route = events.find((e) => e.t === "route.decided") as Extract<BuildEvent, { t: "route.decided" }> | undefined;
      Object.assign(record, { outcome: result.outcome, route: result.route, reason: route?.reason, question: route?.question, missing: route?.missing, modelCalls: result.modelCalls, ms: Date.now() - t0, agreement: result.winner?.agreement });
      if (result.winner) {
        // Install in a scratch store as if approved, run the initial event twice.
        const repo = new Repo(openDatabase(":memory:"));
        const broker = new Broker(repo, pool);
        const recipe = result.winner.recipe;
        const slotFiles = Object.fromEntries(recipe.inputs.map((i) => [i.slot, result.files.find((f) => f.slot === i.slot)?.name]));
        const grants = defaultGrants(recipe, slotFiles);
        const { tool } = repo.install({ name: result.winner.title, description: result.winner.description, requestKey: m.id, hash: recipeHash(recipe), recipe, english: result.winner.english, passport: passportFor(grants), grants, examples: [], buildId: m.id, fileIds: [] });
        const inputs = recipe.inputs.map((i) => {
          const f = result.files.find((x) => x.slot === i.slot)!;
          return { slot: i.slot, inline: { name: f.name, format: f.format, text: f.text } };
        });
        const first = await broker.run(tool.id, inputs, { eventKey: "initial" });
        const second = m.repeatEvent ? await broker.run(tool.id, inputs, { eventKey: "initial" }) : undefined;
        Object.assign(record, {
          recipe,
          permissions: [...recipe.inputs.map((i) => `read:${slotFiles[i.slot] ?? i.slot}`), ...(recipe.outputs.some((o) => o.kind === "file") ? ["write:outputs"] : [])],
          runStatus: first.run.status,
          artifacts: first.artifacts.map((a) => ({ name: a.name, format: a.format, text: a.text })),
          duplicateWrites: second ? second.receipts.filter((r) => r.status === "committed").length : 0,
        });
      }
    } catch (error) {
      Object.assign(record, { outcome: "crashed", error: (error as Error).message.slice(0, 400), ms: Date.now() - t0 });
    }
    appendFileSync(captured, JSON.stringify(record) + "\n");
    writeFileSync(join(out, "tapes", `${m.id}.json`), JSON.stringify({ format: "forge-tape/1", id: `holdout-${m.id}`, title: m.id, provenance: "recorded", model, hardware: "NVIDIA GeForce RTX 5050 Laptop GPU", recordedAt: new Date().toISOString(), commit: head, request: m.request, files: files.map((f) => ({ slot: f.name, name: f.name, format: f.name.split(".").pop(), text: f.text })), events }) + "\n");
    console.log(`${m.id} ${record.outcome} ${record.route ?? ""} ${(Number(record.ms) / 1000).toFixed(1)}s`);
  }
  await pool.close();
  console.log(`captured → ${captured}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
