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
import type { Recipe } from "../src/core/recipe/schema";

type FileExpect = { kind: "file"; name: string; anyHeader?: boolean; alternatives?: string[][] };
type Expected =
  | (FileExpect & { format: "csv" | "tsv"; rows: string[][] })
  | (FileExpect & { format: "json"; value: unknown })
  | (FileExpect & { format: "text"; lines: string[] })
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
  const manifest = JSON.parse(readFileSync("evaluation/validation/manifest.json", "utf8"));
  if (sha(text) !== manifest.sha256) throw new Error("validation/missions.json does not match its frozen hash; record an erratum instead of editing it");
  const c = JSON.parse(text);
  return { name: "validation", hash: sha(text), cases: c.cases };
}

function sha(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function compareFile(expected: Extract<Expected, { kind: "file" }>, out: { name: string; text: string; value?: unknown } | undefined): { ok: boolean; why?: string } {
  if (!out) return { ok: false, why: `no output named ${expected.name}` };
  if (expected.format === "csv" || expected.format === "tsv") {
    try {
      const parsed = parseDelimited(out.text, { delimiter: expected.format === "tsv" ? "	" : "," });
      const rows = expected.anyHeader ? parsed.rows : [parsed.columns, ...parsed.rows];
      const want = expected.anyHeader ? expected.rows.slice(1) : expected.rows;
      const ok = JSON.stringify(rows) === JSON.stringify(want);
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
  const ok = [(expected as { lines: string[] }).lines, ...(expected.alternatives ?? [])].some((alt) => JSON.stringify(lines) === JSON.stringify(alt));
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
    const recipes = new Map<string, Recipe>();
    const emitAll = (body: BuildEventBody) => {
      if (body.t === "candidate.parsed") recipes.set(body.id, body.recipe);
      emit(body);
    };
    const exp = m.expected;
    // Score a recipe on this mission's own files against the independent expectation.
    const score = (recipe: Recipe, slots: string[]): { ok: boolean; why?: string; permsOk: boolean | null } => {
      if (exp.kind !== "file") return { ok: false, permsOk: null };
      const runFiles = (files.length ? files : (base?.files ?? [])).map((f, i) => ({ slot: slots[i] ?? recipe.inputs[i]?.slot, name: f.name, format: f.format as never, text: f.text }));
      try {
        const inputs = loadInputs(recipe, runFiles);
        const plan = compileRecipe(recipe, Object.fromEntries(Object.entries(inputs).map(([k, t]) => [k, schemaOf(profileTable(t))])));
        const run = runPlan(plan, inputs, { now: "2026-10-21T16:00:00.000Z" });
        const out = run.outputs.find((o) => o.kind === "file" && o.name === exp.name) as { name: string; text: string; value?: unknown } | undefined;
        const cmp = compareFile(exp, out);
        let permsOk: boolean | null = null;
        if (m.expectedPermissions) {
          const reads = recipe.inputs.map((i) => `read:${runFiles.find((f) => f.slot === i.slot)?.name ?? i.slot}`);
          const perms = [...new Set([...reads, ...(recipe.outputs.some((o) => o.kind === "file") ? ["write:outputs"] : [])])].sort();
          permsOk = JSON.stringify(perms) === JSON.stringify([...m.expectedPermissions].sort());
        }
        return { ok: cmp.ok, why: cmp.why, permsOk };
      } catch (error) {
        return { ok: false, why: `run failed: ${(error as Error).message}`, permsOk: null };
      }
    };
    let clarified = false;
    let firstCorrect: boolean | null = null;
    try {
      const result = await runCrucible(m.request, files.map((f) => ({ name: f.name, text: f.text, format: f.format as never })), {
        transport,
        emit: emitAll,
        drafts,
        now: "2026-10-21T16:00:00.000Z",
        tools: [...installed.values()].map((x) => x.tool),
        lastToolId: base?.tool.toolId,
        lower: (recipe, plan) => lowerAndVerify(recipe, plan).lowered,
        verify: async (recipe, plan, inputs) => lowerAndVerify(recipe, plan, inputs).checks,
        provenance: "live",
        hardware: process.env.FORGE_HARDWARE ?? "NVIDIA GeForce RTX 5050 Laptop GPU",
        // A simulated person picks the reading whose result on their own file is
        // the one they wanted. It sees only the offered options.
        ask: async ({ options }) => {
          clarified = true;
          const started = events.find((e) => e.t === "build.started") as Extract<BuildEvent, { t: "build.started" }> | undefined;
          const slots = started?.inputs.map((i) => i.slot) ?? [];
          const verdicts = options.map((o) => ({ o, ok: recipes.has(o.candidate) && score(recipes.get(o.candidate)!, slots).ok }));
          firstCorrect = verdicts[0]?.ok ?? false;
          const pick = verdicts.find((v) => v.ok);
          return pick ? { cluster: pick.o.cluster } : undefined;
        },
      });
      route = result.route;
      modelCalls = result.modelCalls;
      ttp = result.timeToPreviewMs;
      candidates = result.candidates.filter((c) => !c.parent).length;
      agreement = result.winner?.agreement;
      if (exp.kind === "connection") {
        const text = `${events.map((e) => (e.t === "route.decided" ? `${e.reason} ${(e.missing ?? []).join(" ")}` : "")).join(" ")}`.toLowerCase();
        const ok = result.outcome === "connect" && exp.serviceTerms.some((t) => text.includes(t));
        status = ok ? "passed" : "failed";
        why = ok ? "" : `expected CONNECT, got ${result.outcome}`;
      } else if (exp.kind === "clarify") {
        status = result.outcome === "clarify" ? "passed" : "failed";
        why = status === "passed" ? "" : `expected CLARIFY, got ${result.outcome}`;
      } else if (exp.kind === "unsupported") {
        status = result.outcome === "unsupported" ? "passed" : "failed";
        why = status === "passed" ? "" : `expected UNSUPPORTED, got ${result.outcome}`;
      } else {
        let recipe = result.winner?.recipe;
        if (result.outcome === "reuse" && result.reuseToolId) recipe = [...installed.values()].find((x) => x.tool.toolId === result.reuseToolId)?.tool.recipe;
        if (!recipe) why = result.reason ?? result.outcome;
        else {
          const slots = result.files.map((f) => f.slot as string);
          const scored = score(recipe, slots.length ? slots : recipe.inputs.map((i) => i.slot));
          permissionsOk = scored.permsOk;
          const routeOk = m.expectedRoute === route;
          status = scored.ok && routeOk && permissionsOk !== false ? "passed" : "failed";
          why = !scored.ok ? (scored.why ?? "output differs") : !routeOk ? `route ${route}, expected ${m.expectedRoute}` : permissionsOk === false ? "reads a file it does not need" : "";
          verifiedFalse = !scored.ok && result.outcome === "review";
          if (!clarified) firstCorrect = scored.ok;
          if (result.winner) {
            installed.set(m.id, {
              tool: {
                toolId: `tool-${m.id}`,
                name: result.winner.title,
                description: result.winner.description,
                requestKey: requestKey(m.request),
                recipe,
                slots: recipe.inputs.map((i) => i.slot),
                columns: Object.fromEntries(recipe.inputs.map((i) => [i.slot, result.tables[i.slot]?.columns ?? []])),
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
    const record = { id: m.id, category: m.category, phrasing: m.phrasing, expectedRoute: m.expectedRoute, status, clarified, firstPreviewCorrect: firstCorrect, why: why || undefined, route, modelCalls, ms, timeToPreviewMs: ttp !== undefined ? Math.round(ttp) : undefined, candidates, agreement, permissionsOk, verifiedFalseSuccess: verifiedFalse };
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
    verifiedFalseSuccess: results.filter((r) => r.verifiedFalseSuccess).length,
    decisions: (() => {
      const d = results.filter((r) => ["CONNECT", "CLARIFY", "UNSUPPORTED"].includes(r.expectedRoute as string));
      return { n: d.length, correct: d.filter((r) => r.status === "passed").length };
    })(),
    firstPreviewCorrect: results.filter((r) => r.firstPreviewCorrect === true).length,
    clarified: results.filter((r) => r.clarified).length,
    byPhrasing: Object.fromEntries(
      ["precise", "ordinary", "vague"]
        .map((p) => [p, results.filter((r) => r.phrasing === p)] as const)
        .filter(([, rs]) => rs.length)
        .map(([p, rs]) => [p, { n: rs.length, passed: rs.filter((r) => r.status === "passed").length }]),
    ),
    byCategory: Object.fromEntries(
      [...new Set(results.map((r) => r.category as string))].map((c) => {
        const rs = results.filter((r) => r.category === c);
        return [c, { n: rs.length, passed: rs.filter((r) => r.status === "passed").length }];
      }),
    ),
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
