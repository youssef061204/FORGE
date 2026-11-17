/**
 * Mission runner for the development and validation corpora.
 *
 *   npx tsx evaluation/runner.ts --corpus=dev [--limit=N] [--only=id,id] [--model=name] [--drafts=5] [--out=dir]
 *
 * Synthesis never sees expected outputs. They are compared only after a
 * mission's result is captured. Nothing here branches on a mission id.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDelimited } from "../src/core/codec/csv";
import type { BuildEvent, BuildEventBody } from "../src/core/events/types";
import { compileRecipe, runPlan } from "../src/core/recipe/engine";
import { profileTable, schemaOf } from "../src/core/profile";
import { createHash } from "node:crypto";
import { loadInputs, runCrucible, type InstalledTool } from "../src/core/synth/crucible";
import { requestKey } from "../src/core/synth/route";
import { chooseModel, discoverOllama, OllamaTransport } from "../src/server/models/ollama";
import { lowerAndVerify } from "../src/server/verify";
import { keyOf, type Json } from "../src/core/table";

type Expected =
  | { kind: "file"; name: string; format: "csv"; rows: string[][] }
  | { kind: "file"; name: string; format: "json"; value: unknown }
  | { kind: "file"; name: string; format: "text"; lines: string[] }
  | { kind: "connection"; serviceTerms: string[] }
  | { kind: "clarify"; terms?: string[] }
  | { kind: "unsupported" };
type Mission = {
  id: string;
  category: string;
  request: string;
  files: { name: string; format: string; text: string }[];
  expectedRoute: string;
  expectedPermissions?: string[];
  expected: Expected;
  dependsOn?: string;
  followUp?: boolean;
  expectedModelRequests?: number;
  phrasing?: string;
};

const args = new Map(process.argv.slice(2).map((a) => (a.includes("=") ? (a.split(/=(.*)/s).slice(0, 2) as [string, string]) : [a, "true"])));
const corpusName = args.get("--corpus") ?? "dev";

function loadCorpus(): { name: string; hash: string; cases: Mission[] } {
  if (corpusName === "dev") {
    const text = readFileSync("evaluation/local-missions.json", "utf8");
    const c = JSON.parse(text);
    return {
      name: "dev",
      hash: sha(text),
      cases: c.cases.map((m: Mission & { goal: string }) => ({ ...m, request: m.goal })),
    };
  }
  const text = readFileSync(`evaluation/validation/missions.json`, "utf8");
  const c = JSON.parse(text);
  return { name: "validation", hash: sha(text), cases: c.cases };
}

function sha(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function compareFile(expected: Extract<Expected, { kind: "file" }>, out: { name: string; text: string; value?: unknown } | undefined): { ok: boolean; why?: string } {
  if (!out) return { ok: false, why: `no output named ${expected.name}` };
  if (expected.format === "csv") {
    try {
      const parsed = parseDelimited(out.text);
      const rows = [parsed.columns, ...parsed.rows];
      const ok = JSON.stringify(rows) === JSON.stringify(expected.rows);
      return ok ? { ok } : { ok, why: `csv differs: got ${JSON.stringify(rows).slice(0, 300)}` };
    } catch (e) {
      return { ok: false, why: `csv unreadable: ${(e as Error).message}` };
    }
  }
  if (expected.format === "json") {
    let v: unknown;
    try {
      v = JSON.parse(out.text);
    } catch {
      return { ok: false, why: "json unreadable" };
    }
    const ok = keyOf(v as Json) === keyOf(expected.value as Json);
    return ok ? { ok } : { ok, why: `json differs: got ${JSON.stringify(v).slice(0, 300)}` };
  }
  const lines = out.text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const ok = JSON.stringify(lines) === JSON.stringify(expected.lines);
  return ok ? { ok } : { ok, why: `text differs: got ${JSON.stringify(lines).slice(0, 300)}` };
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

/** Wilson score interval for a proportion. */
function wilson(k: number, n: number) {
  if (!n) return [0, 0];
  const z = 1.96,
    p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)].map((x) => Math.round(x * 1000) / 1000);
}

async function main() {
  const corpus = loadCorpus();
  const only = args.get("--only")?.split(",");
  const limit = Number(args.get("--limit") ?? Infinity);
  const cases = corpus.cases.filter((c) => !only || only.includes(c.id) || only.some((o) => c.dependsOn === o)).slice(0, limit);
  const found = await discoverOllama(process.env.FORGE_OLLAMA_URL);
  if (!found) throw new Error("No local Ollama found on 127.0.0.1:11434 or :11435");
  const model = chooseModel(found.models, args.get("--model") ?? process.env.FORGE_MODEL);
  if (!model) throw new Error("No usable local model installed");
  const transport = new OllamaTransport(found.url, model);
  const drafts = Number(args.get("--drafts") ?? 5);
  const commit = execSync("git rev-parse --short HEAD").toString().trim();
  const dirty = execSync("git status --porcelain src evaluation/runner.ts").toString().trim().length > 0;
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = args.get("--out") ?? join("evaluation", "results", `${stamp}-${commit}${dirty ? "-dirty" : ""}`);
  mkdirSync(join(outDir, "tapes"), { recursive: true });
  const installed = new Map<string, { tool: InstalledTool; files: Mission["files"] }>();
  const results: Record<string, unknown>[] = [];
  console.log(`corpus=${corpus.name} cases=${cases.length} model=${model} drafts=${drafts} out=${outDir}`);
  for (const m of cases) {
    const events: BuildEvent[] = [];
    let seq = 0;
    const t0 = Date.now();
    const emit = (body: BuildEventBody) => events.push({ buildId: m.id, seq: seq++, atMs: Date.now() - t0, ...body } as BuildEvent);
    const base = m.dependsOn ? installed.get(m.dependsOn) : undefined;
    const files = m.files.length ? m.files : m.followUp && base ? base.files : [];
    const started = Date.now();
    let status: "passed" | "failed" = "failed";
    let why = "";
    let route = "";
    let modelCalls = 0;
    let ttp: number | undefined;
    let agreement: string | undefined;
    let candidates = 0;
    let verifiedFalse = false;
    let permissionsOk: boolean | null = null;
    try {
      const result = await runCrucible(m.request, files.map((f) => ({ name: f.name, text: f.text, format: f.format as never })), {
        transport,
        emit,
        drafts,
        now: "2026-10-21T16:00:00.000Z",
        tools: [...installed.values()].map((x) => x.tool),
        lastToolId: base?.tool.toolId,
        lower: (recipe, plan) => lowerAndVerify(recipe, plan).lowered,
        verify: async (recipe, plan, inputs) => lowerAndVerify(recipe, plan, inputs).checks,
        provenance: "live",
        hardware: process.env.FORGE_HARDWARE ?? "NVIDIA GeForce RTX 5050 Laptop GPU",
      });
      route = result.route;
      modelCalls = result.modelCalls;
      ttp = result.timeToPreviewMs;
      candidates = result.candidates.filter((c) => !c.parent).length;
      agreement = result.winner?.agreement;
      const exp = m.expected;
      if (exp.kind === "connection") {
        const text = `${events.map((e) => (e.t === "route.decided" ? `${e.reason} ${(e.missing ?? []).join(" ")}` : "")).join(" ")}`.toLowerCase();
        const ok = result.outcome === "connect" && exp.serviceTerms.some((t) => text.includes(t));
        status = ok ? "passed" : "failed";
        why = ok ? "" : `expected CONNECT, got ${result.outcome}`;
        permissionsOk = ok;
      } else if (exp.kind === "clarify") {
        status = result.outcome === "clarify" ? "passed" : "failed";
        why = status === "passed" ? "" : `expected CLARIFY, got ${result.outcome}`;
      } else if (exp.kind === "unsupported") {
        status = result.outcome === "unsupported" ? "passed" : "failed";
        why = status === "passed" ? "" : `expected UNSUPPORTED, got ${result.outcome}`;
      } else {
        let recipe = result.winner?.recipe;
        if (result.outcome === "reuse" && result.reuseToolId) recipe = [...installed.values()].find((x) => x.tool.toolId === result.reuseToolId)?.tool.recipe;
        if (!recipe) {
          why = result.reason ?? result.outcome;
        } else {
          const runFiles = (files.length ? files : (base?.files ?? [])).map((f, i) => ({ slot: result.files[i]?.slot ?? recipe!.inputs[i]?.slot, name: f.name, format: f.format as never, text: f.text }));
          const slotted = runFiles.map((f, i) => ({ ...f, slot: f.slot ?? recipe!.inputs[i].slot }));
          const plan = result.winner?.plan ?? compileRecipe(recipe, Object.fromEntries(Object.entries(loadInputs(recipe, slotted)).map(([k, t]) => [k, schemaOf(profileTable(t))])));
          const run = runPlan(plan, loadInputs(recipe, slotted), { now: "2026-10-21T16:00:00.000Z" });
          const out = run.outputs.find((o) => o.kind === "file" && o.name === exp.name) as { name: string; text: string; value?: unknown } | undefined;
          const cmp = compareFile(exp, out);
          // Permissions: reads of the input files actually used, plus writes.
          if (m.expectedPermissions) {
            const reads = recipe.inputs.map((i) => `read:${slotted.find((f) => f.slot === i.slot)?.name ?? i.slot}`);
            const perms = [...reads, ...(recipe.outputs.some((o) => o.kind === "file") ? ["write:outputs"] : [])].sort();
            permissionsOk = JSON.stringify(perms) === JSON.stringify([...m.expectedPermissions].sort());
          }
          const routeOk = m.expectedRoute === route || (m.expectedRoute === "SYNTHESIZE" && route === "SYNTHESIZE");
          status = cmp.ok && routeOk && permissionsOk !== false ? "passed" : "failed";
          why = !cmp.ok ? (cmp.why ?? "output differs") : !routeOk ? `route ${route}, expected ${m.expectedRoute}` : permissionsOk === false ? "permissions differ" : "";
          verifiedFalse = !cmp.ok;
          if (result.winner) {
            const slots = recipe.inputs.map((i) => i.slot);
            installed.set(m.id, {
              tool: {
                toolId: `tool-${m.id}`,
                name: result.winner.title,
                description: result.winner.description,
                requestKey: requestKey(m.request),
                recipe,
                slots,
                columns: Object.fromEntries(slots.map((s) => [s, result.tables[s]?.columns ?? []])),
              },
              files,
            });
          }
          if (m.expectedModelRequests !== undefined && modelCalls !== m.expectedModelRequests) {
            status = "failed";
            why = `expected ${m.expectedModelRequests} model requests, made ${modelCalls}`;
          }
        }
      }
    } catch (error) {
      why = `crashed: ${(error as Error).stack?.slice(0, 400)}`;
    }
    const ms = Date.now() - started;
    const record = { id: m.id, category: m.category, phrasing: m.phrasing, status, why: why || undefined, route, modelCalls, ms, timeToPreviewMs: ttp !== undefined ? Math.round(ttp) : undefined, candidates, agreement, permissionsOk, verifiedFalseSuccess: verifiedFalse };
    results.push(record);
    if (status === "failed") writeFileSync(join(outDir, "tapes", `${m.id}.json`), JSON.stringify({ format: "forge-tape/1", id: `${corpus.name}-${m.id}`, title: m.id, provenance: "recorded", model, hardware: process.env.FORGE_HARDWARE ?? "NVIDIA GeForce RTX 5050 Laptop GPU", recordedAt: new Date().toISOString(), commit, request: m.request, files: files.map((f, i) => ({ slot: events.find((e) => e.t === "build.started")?.t === "build.started" ? ((events.find((e) => e.t === "build.started") as Extract<BuildEvent, { t: "build.started" }>).inputs[i]?.slot ?? f.name) : f.name, name: f.name, format: f.format, text: f.text })), events }) + "\n");
    console.log(JSON.stringify(record));
  }
  const passed = results.filter((r) => r.status === "passed").length;
  const ttps = results.map((r) => r.timeToPreviewMs as number | undefined).filter((x): x is number => typeof x === "number");
  const summary = {
    corpus: corpus.name,
    corpusHash: corpus.hash,
    model,
    hardware: process.env.FORGE_HARDWARE ?? "NVIDIA GeForce RTX 5050 Laptop GPU (8 GB)",
    commit,
    dirty,
    date: new Date().toISOString(),
    drafts,
    n: results.length,
    passed,
    passRate: results.length ? Math.round((passed / results.length) * 1000) / 1000 : 0,
    interval95: wilson(passed, results.length),
    verifiedFalseSuccess: results.filter((r) => r.verifiedFalseSuccess && r.status !== "passed" && r.route === "SYNTHESIZE").length,
    timeToPreviewP50Ms: percentile(ttps, 50),
    timeToPreviewP95Ms: percentile(ttps, 95),
    totalP50Ms: percentile(results.map((r) => r.ms as number), 50),
    modelCalls: results.reduce((s, r) => s + (r.modelCalls as number), 0),
    command: `npx tsx evaluation/runner.ts --corpus=${corpus.name} --drafts=${drafts}`,
  };
  writeFileSync(join(outDir, `${corpus.name}.json`), JSON.stringify({ summary, results }, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
