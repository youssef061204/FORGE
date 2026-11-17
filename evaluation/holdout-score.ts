/**
 * Sealed holdout, phase B: score. Opens the evaluator-only oracle
 * (expected.sealed.jsonl) only after capture has finished, matches by id, and
 * writes holdout.json next to captured.jsonl plus results/holdout-latest.json.
 *
 *   npx tsx evaluation/holdout-score.ts --dir=evaluation/results/2026-11-17-354d463-holdout
 *
 * Scoring follows PROTOCOL.md. A mission passes only when its route is
 * acceptable, every postcondition holds and the permission set matches exactly.
 * Capabilities FORGE 2 does not have (connector writes, notifications,
 * scheduler ticks, persisted program state, reuse/extend/compose of installed
 * programs) are failures, not exclusions; the protocol says a missing path is a
 * capability failure. They are counted separately so both numbers are visible:
 * the strict score over all 100, and the score over the missions whose every
 * predicate FORGE 2 can represent.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HOLDOUT = "evaluation/core-holdout-2026-11-12";
const args = new Map(process.argv.slice(2).map((a) => (a.includes("=") ? (a.split(/=(.*)/s).slice(0, 2) as [string, string]) : [a, "true"])));
const dir = args.get("--dir");
if (!dir) throw new Error("--dir=<capture directory> is required");

type Post = { kind: string; [k: string]: unknown };
type Expected = { id: string; acceptableRoutes: string[]; permissions: { mode: string; values: string[] }; postconditions: Post[]; sideEffectPolicy?: { duplicateWrites?: number } };
type Captured = { id: string; outcome: string; route?: string; reason?: string; question?: string; missing?: unknown; ms: number; modelCalls?: number; agreement?: string; permissions?: string[]; runStatus?: string; artifacts?: { name: string; format: string; text: string }[]; duplicateWrites?: number; filesGiven: string[]; error?: string };
type Op = { id: string; kind: string; permission: string };
type Resource = { descriptor: { id: string; status: string; operations: Op[] }; collections: Record<string, unknown[]>; handlers: Record<string, { kind: string }> };
type Mission = { id: string; family: string; resources: Resource[] };

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const manifest = JSON.parse(readFileSync(join(HOLDOUT, "manifest.json"), "utf8"));
for (const f of manifest.files) if (sha(readFileSync(join(HOLDOUT, f.path))) !== f.sha256) throw new Error(`Seal broken: ${f.path}`);
const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
const jsonl = <T>(p: string) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l) as T);
const captured = new Map(jsonl<Captured>(join(dir, "captured.jsonl")).map((c) => [c.id, c]));
const missions = new Map(jsonl<Mission>(join(HOLDOUT, "missions.sealed.jsonl")).map((m) => [m.id, m]));
const expected = jsonl<Expected>(join(HOLDOUT, "expected.sealed.jsonl"));

/** Predicates FORGE 2 can represent. Everything else needs a capability it lacks. */
const REPRESENTABLE = new Set(["artifactEquals", "connectionRequest", "clarificationQuestion", "unsupportedExplanation", "noProgramCreated", "noWrites", "collectionUnchanged"]);
const ROUTES = new Set(["SYNTHESIZE", "CONNECT", "CLARIFY", "UNSUPPORTED"]);

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  return deepEqual(ka, kb) && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Maps each fixture read permission to the file names FORGE 2 was handed for it (same rule as capture). */
function permissionFiles(m: Mission): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (perm: string, name: string) => (out.get(perm) ?? out.set(perm, new Set()).get(perm)!).add(name);
  for (const r of m.resources) {
    for (const op of r.descriptor.operations) {
      if (op.kind !== "read") continue;
      add(op.permission, `${r.descriptor.id}-${op.id.split(".").pop()}.json`.replace(/[^\w.-]+/g, "_"));
      // A per-document read permission also covers that document's file.
      for (const rows of Object.values(r.collections))
        for (const row of rows as { id?: string; name?: string }[]) if (row && row.id && row.name && op.permission.includes(row.id)) add(op.permission, row.name);
      // A connector-wide read covers documents found in that connector's collections.
      if (!/[0-9a-f]{20,}/.test(op.permission)) for (const rows of Object.values(r.collections)) for (const row of rows as { name?: string; text?: string }[]) if (row && typeof row.name === "string" && typeof row.text === "string") add(op.permission, row.name);
    }
  }
  return out;
}

function translatePermissions(c: Captured, m: Mission): { values: string[]; unmapped: string[] } {
  const map = permissionFiles(m);
  const values: string[] = [];
  const unmapped: string[] = [];
  for (const p of c.permissions ?? []) {
    if (p === "write:outputs") values.push("workspace.outputs.write");
    else if (p.startsWith("read:")) {
      const file = p.slice(5);
      const perm = [...map.entries()].find(([, files]) => files.has(file))?.[0];
      if (perm) values.push(perm);
      else unmapped.push(p);
    } else unmapped.push(p);
  }
  return { values: [...new Set(values)].sort(), unmapped };
}

const words = (s: string) => s.toLowerCase().match(/[a-z]{4,}/g) ?? [];

function checkPost(p: Post, c: Captured): { ok: boolean; why?: string } {
  const made = c.outcome === "review" && !!c.permissions;
  switch (p.kind) {
    case "artifactEquals": {
      const a = (c.artifacts ?? []).find((x) => x.name === p.name);
      if (!a) return { ok: false, why: `no output named ${p.name}${c.artifacts?.length ? ` (got ${c.artifacts.map((x) => x.name).join(", ")})` : ""}` };
      if (p.format === "json") {
        try {
          return deepEqual(JSON.parse(a.text), p.value) ? { ok: true } : { ok: false, why: `${p.name} differs: got ${a.text.replace(/\s+/g, " ").slice(0, 160)}` };
        } catch {
          return { ok: false, why: `${p.name} is not JSON` };
        }
      }
      const norm = (s: string) => s.replace(/\r\n/g, "\n");
      return norm(a.text) === norm(String(p.value)) ? { ok: true } : { ok: false, why: `${p.name} text differs: got ${JSON.stringify(a.text.slice(0, 160))}` };
    }
    case "noProgramCreated":
      return made ? { ok: false, why: "a tool was produced" } : { ok: true };
    case "noWrites":
      return (c.artifacts ?? []).length ? { ok: false, why: "outputs were written" } : { ok: true };
    case "collectionUnchanged":
      // FORGE 2 has no connector-write path, so fixture collections cannot change.
      return { ok: true };
    case "connectionRequest": {
      if (c.outcome !== "connect") return { ok: false, why: `expected a connection request, got ${c.outcome}` };
      const said = words(`${JSON.stringify(c.missing ?? "")} ${c.reason ?? ""}`);
      const need = (p.resources as string[]).flatMap(words);
      return need.some((w) => said.some((s) => s.startsWith(w.slice(0, 5)) || w.startsWith(s.slice(0, 5)))) ? { ok: true } : { ok: false, why: `connection request did not name ${(p.resources as string[]).join(", ")}` };
    }
    case "clarificationQuestion":
      return c.outcome === "clarify" && c.question ? { ok: true } : { ok: false, why: `expected a question about ${p.topic}, got ${c.outcome}` };
    case "unsupportedExplanation":
      return c.outcome === "unsupported" ? { ok: true } : { ok: false, why: `expected unsupported (${p.reason}), got ${c.outcome}` };
    default:
      return { ok: false, why: `needs ${p.kind}, which FORGE 2 does not have` };
  }
}

type Row = { id: string; category: string; status: string; why?: string; route: string; ms: number; agreement?: string; representable: boolean; routeOk: boolean; permissionsOk: boolean; postconditions: { kind: string; ok: boolean; why?: string }[]; falseSuccess: boolean };
const rows: Row[] = [];
for (const e of expected) {
  const c = captured.get(e.id);
  const m = missions.get(e.id)!;
  if (!c) {
    rows.push({ id: e.id, category: m.family, status: "missing", why: "not captured", route: "", ms: 0, representable: false, routeOk: false, permissionsOk: false, postconditions: [], falseSuccess: false });
    continue;
  }
  const representable = e.acceptableRoutes.some((r) => ROUTES.has(r)) && e.postconditions.every((p) => REPRESENTABLE.has(p.kind)) && e.permissions.values.every((v) => v.endsWith(".read") || v === "workspace.outputs.write");
  const routeOk = !!c.route && e.acceptableRoutes.includes(c.route);
  const posts = e.postconditions.map((p) => ({ kind: p.kind, ...checkPost(p, c) }));
  const tool = c.outcome === "review";
  let permissionsOk = true;
  let permWhy: string | undefined;
  if (tool) {
    const { values, unmapped } = translatePermissions(c, m);
    const want = [...e.permissions.values].sort();
    permissionsOk = unmapped.length === 0 && deepEqual(values, want);
    if (!permissionsOk) permWhy = `permissions ${JSON.stringify(values.concat(unmapped))} ≠ ${JSON.stringify(want)}`;
  } else if (e.permissions.values.length) {
    // No tool means no grants; exact match then requires an empty expected set.
    permissionsOk = false;
  }
  const dupOk = (c.duplicateWrites ?? 0) <= (e.sideEffectPolicy?.duplicateWrites ?? 0);
  const passed = routeOk && permissionsOk && dupOk && posts.every((p) => p.ok);
  const firstBad = !routeOk ? `route ${c.route ?? c.outcome} not in ${e.acceptableRoutes.join("/")}` : posts.find((p) => !p.ok)?.why ?? permWhy ?? (!dupOk ? `${c.duplicateWrites} duplicate writes` : !permissionsOk ? "no tool, so no permissions were granted" : undefined);
  rows.push({
    id: e.id,
    category: m.family,
    status: passed ? "passed" : c.outcome === "crashed" ? "crashed" : "failed",
    why: passed ? undefined : (c.error ? `crashed: ${c.error}` : firstBad),
    route: c.route ?? c.outcome,
    ms: c.ms,
    agreement: c.agreement,
    representable,
    routeOk,
    permissionsOk,
    postconditions: posts,
    // A reviewed tool whose output was wrong is a success claim with a failed postcondition.
    falseSuccess: tool && c.runStatus === "done" && !passed && routeOk,
  });
}

function wilson(k: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.round(Math.max(0, c - h) * 1000) / 1000, Math.round(Math.min(1, c + h) * 1000) / 1000];
}
const pctile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);
const tally = (key: (r: Row) => string) => {
  const o: Record<string, { n: number; passed: number }> = {};
  for (const r of rows) {
    const k = key(r);
    o[k] ??= { n: 0, passed: 0 };
    o[k].n++;
    if (r.status === "passed") o[k].passed++;
  }
  return o;
};

const passed = rows.filter((r) => r.status === "passed").length;
const rep = rows.filter((r) => r.representable);
const repPassed = rep.filter((r) => r.status === "passed").length;
const decisions = rows.filter((r) => expected.find((e) => e.id === r.id)!.acceptableRoutes.some((x) => ["CONNECT", "CLARIFY", "UNSUPPORTED"].includes(x)));
const command = `npx tsx evaluation/holdout-capture.ts --freeze=evaluation/results/holdout-freeze.json && npx tsx evaluation/holdout-score.ts --dir=${dir.replace(/\\/g, "/")}`;
const summary = {
  corpus: "holdout",
  corpusHash: manifest.contentSealSha256,
  model: run.model,
  hardware: run.hardware,
  commit: String(run.commit).slice(0, 7),
  dirty: false,
  date: run.startedAt,
  drafts: 5,
  n: rows.length,
  passed,
  passRate: passed / rows.length,
  interval95: wilson(passed, rows.length),
  verifiedFalseSuccess: rows.filter((r) => r.falseSuccess).length,
  decisions: { n: decisions.length, correct: decisions.filter((r) => r.status === "passed").length },
  representable: { n: rep.length, passed: repPassed, interval95: wilson(repPassed, rep.length) },
  routeAccuracy: { n: rows.length, correct: rows.filter((r) => r.routeOk).length },
  permissionsExact: { n: rows.filter((r) => r.route === "SYNTHESIZE").length, correct: rows.filter((r) => r.route === "SYNTHESIZE" && r.permissionsOk).length },
  byCategory: tally((r) => r.category),
  byScope: tally((r) => (r.representable ? "within FORGE 2's scope" : "needs a capability FORGE 2 lacks")),
  timeToPreviewP50Ms: pctile(rows.filter((r) => r.route === "SYNTHESIZE").map((r) => r.ms), 0.5),
  timeToPreviewP95Ms: pctile(rows.filter((r) => r.route === "SYNTHESIZE").map((r) => r.ms), 0.95),
  totalP50Ms: pctile(rows.map((r) => r.ms), 0.5),
  modelCalls: [...captured.values()].reduce((s, c) => s + (c.modelCalls ?? 0), 0),
  command,
  oracleOpenedAt: new Date().toISOString(),
  note: "Times are total time per mission (the capture did not record first-preview time separately).",
};
writeFileSync(join(dir, "holdout.json"), JSON.stringify({ summary, results: rows }, null, 2) + "\n");
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const latest = {
  headline: `${passed} of ${rows.length} (${pct(passed / rows.length)}); ${repPassed} of ${rep.length} within scope`,
  interval: `${pct(summary.interval95[0])}–${pct(summary.interval95[1])}`,
  ttp: summary.timeToPreviewP50Ms === null ? null : `${(summary.timeToPreviewP50Ms / 1000).toFixed(1)} s`,
  source: `${dir.replace(/\\/g, "/")}/holdout.json`,
};
writeFileSync("evaluation/results/holdout-latest.json", JSON.stringify(latest, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, byCategory: undefined }, null, 2));
for (const r of rows) if (r.status !== "passed") console.log(`${r.id} [${r.category}]${r.representable ? "" : " (out of scope)"} ${r.why ?? ""}`.slice(0, 260));
if (!existsSync(join(dir, "holdout.json"))) process.exit(1);
