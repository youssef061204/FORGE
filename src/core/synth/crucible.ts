/**
 * The Crucible: synthesis that works on a small local model. Reliability comes
 * from the system around the model: profile the data without a model, route
 * by rule, draft K candidates, gate them, run them on real data and host-made
 * variants, check properties, cluster by behavior, ask when two readings
 * disagree, repair from structured diagnostics, and preview the winner with
 * lineage. Every stage emits events, so the pipeline is also the show.
 */
import { decode, formatFromName, sniffFormat, type Format } from "../codec";
import type { CapabilityId } from "../contracts/capabilities";
import { defaultGrants, passportFor } from "../contracts/passport";
import type { AmbiguityOption, BuildEventBody, Example, FilePreview, PreviewTable, StepPreview } from "../events/types";
import { digest } from "../hash";
import { profileTable, schemaOf, type TableProfile } from "../profile";
import { RecipeError, formatDiagnostic, type Diagnostic } from "../recipe/diagnostics";
import { compileRecipe, runPlan, RecipeRuntimeError, type Plan } from "../recipe/engine";
import { englishRecipe } from "../recipe/english";
import { RECIPE_VERSION, type Recipe } from "../recipe/schema";
import { keyOf, type Table } from "../table";
import { behave, clusterize, decide, distinguishing, fingerprint, settled, type Behavior, type Group, type Member } from "../verify/cluster";
import { checkProperties } from "../verify/properties";
import { fuzzInputs, makeVariants, type Inputs } from "../verify/variants";
import { EXEMPLARS, type Exemplar } from "./exemplars";
import { parseRecipeText, extractJson } from "./normalize";
import { alignShapes } from "./align";
import { DRAFT_SYSTEM, INTENT_SCHEMA, OUTPUT_SHAPES, type OutputShape, INTENT_SYSTEM, draftPrompt, exemplarBlock, intentPrompt, repairPrompt, type DraftContext } from "./prompt";
import { decideRoute, findExtendTarget, requestKey } from "./route";
import { recipeJsonSchema } from "../recipe/schema";
import { Retriever } from "./similarity";
import { AbortedError, type ModelTransport } from "./transport";

export type InputFile = { slot?: string; name: string; format?: Format; text: string };
export type InstalledTool = { toolId: string; name: string; description: string; requestKey: string; recipe: Recipe; slots: string[]; columns: Record<string, string[]> };
export type AmbiguityAnswer = { cluster: string } | undefined;

export type CrucibleOptions = {
  transport: ModelTransport;
  emit: (body: BuildEventBody) => void;
  now?: string;
  drafts?: number;
  budgetMs?: number;
  concurrency?: number;
  maxRepairs?: number;
  exemplars?: Exemplar[];
  tools?: InstalledTool[];
  lastToolId?: string;
  examples?: Example[];
  enabled?: Partial<Record<CapabilityId, boolean>>;
  /** Ask the person which result they meant. Without it the larger cluster wins. */
  ask?: (question: { options: AmbiguityOption[] }) => Promise<AmbiguityAnswer>;
  /** Extra checks the host can run (e.g. emitted-TypeScript differential). */
  verify?: (recipe: Recipe, plan: Plan, inputs: Inputs[]) => Promise<{ kind: "differential" | "replay"; name: string; passed: boolean; detail?: string }[]>;
  lower?: (recipe: Recipe, plan: Plan) => { irHash: string; ir: unknown; typescript?: string } | undefined;
  signal?: AbortSignal;
  /** "live" only when a model really generates right now. */
  provenance?: "live" | "recorded" | "scripted";
  hardware?: string;
};

export type Candidate = {
  id: string;
  attempt: number;
  parent?: string;
  temperature: number;
  seed: number;
  text: string;
  recipe?: Recipe;
  plan?: Plan;
  diagnostics?: Diagnostic[];
  stage?: string;
  behaviors?: Behavior[];
  fingerprint?: string;
  executed: boolean;
  shapeMismatch?: boolean;
  emptyOnReal?: boolean;
};

export type CrucibleResult = {
  outcome: "review" | "failed" | "connect" | "clarify" | "unsupported" | "reuse" | "cancelled";
  route: string;
  winner?: { recipe: Recipe; plan: Plan; hash: string; title: string; description: string; english: string[]; agreement: string };
  reuseToolId?: string;
  candidates: Candidate[];
  clusters: Group[];
  modelCalls: number;
  examples: Example[];
  timeToPreviewMs?: number;
  ms: number;
  tables: Record<string, Table>;
  files: InputFile[];
  intent?: { title: string; restatement: string; needs: CapabilityId[]; outputs: string[] };
  ambiguity?: { asked: boolean; chosen?: string };
  reason?: string;
};

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function slotName(fileName: string, taken: Set<string>): string {
  let base = fileName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[A-Za-z]/.test(base)) base = "file_" + base;
  base = base.slice(0, 28) || "file";
  let name = base;
  let n = 2;
  while (taken.has(name)) name = `${base}_${n++}`;
  taken.add(name);
  return name;
}

export function previewTable(t: Table, limit = 200, lin?: number[][]): PreviewTable {
  return { columns: t.columns, rows: t.rows.slice(0, limit), total: t.rows.length, ...(lin ? { lineage: lin.slice(0, limit) } : {}) };
}

export function recipeHash(recipe: Recipe, irHash?: string): string {
  return digest({ recipe, language: RECIPE_VERSION, ir: irHash ?? null });
}

/** Decode one input, honoring a recipe's JSON path when it gives one. */
export function loadInputs(recipe: Recipe | undefined, files: Required<Pick<InputFile, "slot" | "name" | "format" | "text">>[]): Inputs {
  const out: Inputs = {};
  for (const f of files) {
    const spec = recipe?.inputs.find((i) => i.slot === f.slot);
    const path = spec?.path ? spec.path.split(".").filter(Boolean) : undefined;
    out[f.slot] = decode(f.text, (spec?.format ?? f.format) as Format, path ? { tablePath: path } : {}).table;
  }
  return out;
}

function matchesExample(plan: Plan, example: Example, now?: string): boolean {
  const inputs: Inputs = Object.fromEntries(Object.entries(example.input).map(([k, t]) => [k, { columns: t.columns, rows: t.rows }]));
  try {
    const r = runPlan(plan, inputs, { now });
    const out = r.outputs.find((o) => o.kind === "file" && o.name === example.output);
    if (!out || out.kind !== "file") return false;
    const actual = out.value !== undefined ? out.value : out.table.rows.map((row) => Object.fromEntries(out.table.columns.map((c) => [c, row[c] ?? null])));
    return keyOf(actual as never) === keyOf(example.expected as never);
  } catch {
    return false;
  }
}

export async function runCrucible(request: string, rawFiles: InputFile[], options: CrucibleOptions): Promise<CrucibleResult> {
  const started = clock();
  const emit = options.emit;
  const K = options.drafts ?? 5;
  const budgetMs = options.budgetMs ?? 150_000;
  const now = options.now ?? new Date().toISOString();
  const examples = [...(options.examples ?? [])];
  let modelCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let modelMs = 0;
  const stats = () => emit({ t: "model.stats", calls: modelCalls, promptTokens, completionTokens, ms: Math.round(modelMs) });

  // ---- inputs and profiles (no model) -----------------------------------
  const taken = new Set<string>();
  const files = rawFiles.map((f) => ({
    slot: f.slot ?? slotName(f.name, taken),
    name: f.name,
    format: (f.format ?? formatFromName(f.name) ?? sniffFormat(f.text)) as Format,
    text: f.text,
  }));
  files.forEach((f) => taken.add(f.slot));
  emit({
    t: "build.started",
    request,
    provenance: options.provenance ?? options.transport.provenance,
    model: options.transport.model,
    hardware: options.hardware,
    inputs: files.map((f) => ({ slot: f.slot, name: f.name, format: f.format, rows: 0, bytes: new TextEncoder().encode(f.text).length })),
    drafts: K,
    budgetMs,
  });
  const tables: Record<string, Table> = {};
  const profiles: Record<string, TableProfile> = {};
  for (const f of files) {
    try {
      tables[f.slot] = decode(f.text, f.format).table;
    } catch (error) {
      emit({ t: "build.failed", stage: "understand", reason: `${f.name} could not be read: ${error instanceof Error ? error.message : "unknown format"}`, suggestions: ["Check that the file is CSV, TSV, JSON or plain text", "Try saving it again from the app that made it"] });
      emit({ t: "build.ended", outcome: "failed", ms: Math.round(clock() - started) });
      return { outcome: "failed", route: "SYNTHESIZE", candidates: [], clusters: [], modelCalls, examples, ms: clock() - started, tables, files, reason: "unreadable input" };
    }
    profiles[f.slot] = profileTable(tables[f.slot]);
    emit({ t: "profile.ready", slot: f.slot, name: f.name, rows: profiles[f.slot].rows, columns: profiles[f.slot].columns, sample: tables[f.slot].rows.slice(0, 8) });
  }
  const end = (outcome: CrucibleResult["outcome"], extra: Partial<CrucibleResult> = {}): CrucibleResult => {
    stats();
    emit({ t: "build.ended", outcome, ms: Math.round(clock() - started) });
    return { outcome, route: extra.route ?? "SYNTHESIZE", candidates: [], clusters: [], modelCalls, examples, ms: clock() - started, tables, files, ...extra };
  };

  // ---- exact reuse needs no model ---------------------------------------
  const tools = options.tools ?? [];
  const key = requestKey(request);
  const reuse = tools.find(
    (t) => t.requestKey === key && (files.length === 0 || t.slots.every((s) => files.some((f) => f.slot === s && t.columns[s]?.every((c) => tables[f.slot].columns.includes(c))))),
  );
  if (reuse) {
    const decision = decideRoute({ request, modelNeeds: [], feasible: true, missing: "", files: files.length, enabled: options.enabled, reuse: { toolId: reuse.toolId, name: reuse.name } });
    emit({ t: "route.decided", route: decision.route, reason: decision.reason, toolId: decision.toolId, missing: decision.missing });
    if (decision.route === "REUSE") return end("reuse", { route: "REUSE", reuseToolId: reuse.toolId });
  }

  // ---- intent ------------------------------------------------------------
  const intentStarted = clock();
  let intent = { title: request.split(/[.!?]/)[0].slice(0, 48), restatement: request, outputs: [] as string[], needs: [] as CapabilityId[], feasible: true, missing: "" };
  const intentShapes: Record<string, OutputShape> = {};
  try {
    modelCalls++;
    const res = await options.transport.generate({
      purpose: "intent",
      system: INTENT_SYSTEM,
      prompt: intentPrompt(request, files.map((f) => ({ slot: f.slot, name: f.name, columns: tables[f.slot].columns })), tools.map((t) => ({ name: t.name, description: t.description }))),
      schema: INTENT_SCHEMA,
      temperature: 0,
      seed: 1,
      maxTokens: 300,
      signal: options.signal,
    });
    promptTokens += res.promptTokens;
    completionTokens += res.completionTokens;
    modelMs += res.ms;
    const parsed = extractJson(res.text) as Partial<Omit<typeof intent, "outputs">> & { outputs?: unknown[] };
    for (const o of parsed.outputs ?? [])
      if (o && typeof o === "object" && typeof (o as { name?: unknown }).name === "string" && OUTPUT_SHAPES.includes((o as { shape: OutputShape }).shape))
        intentShapes[(o as { name: string }).name.toLowerCase()] = (o as { shape: OutputShape }).shape;
    intent = {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 60) : intent.title,
      restatement: typeof parsed.restatement === "string" && parsed.restatement.trim() ? parsed.restatement.trim().slice(0, 300) : request,
      outputs: Array.isArray(parsed.outputs) ? parsed.outputs.map((o) => (typeof o === "string" ? o : (o as { name?: string })?.name)).filter((o): o is string => typeof o === "string").slice(0, 8) : [],
      needs: Array.isArray(parsed.needs) ? (parsed.needs.filter((n) => typeof n === "string") as CapabilityId[]) : [],
      feasible: parsed.feasible !== false,
      missing: typeof parsed.missing === "string" ? parsed.missing : "",
    };
  } catch (error) {
    if (error instanceof AbortedError || options.signal?.aborted) return end("cancelled");
    // The intent call is advisory; routing rules still apply without it.
  }
  emit({ t: "intent.ready", title: intent.title, restatement: intent.restatement, outputs: intent.outputs, needs: intent.needs, ms: Math.round(clock() - intentStarted) });

  const extend = findExtendTarget(request, tools.map((t) => ({ toolId: t.toolId, name: t.name })), options.lastToolId);
  const decision = decideRoute({
    request,
    modelNeeds: intent.needs,
    feasible: intent.feasible,
    missing: intent.missing,
    files: files.length || (extend ? 1 : 0),
    enabled: options.enabled,
    extend,
  });
  emit({ t: "route.decided", route: decision.route, reason: decision.reason, missing: decision.missing, toolId: decision.toolId, question: decision.question });
  if (decision.route === "CONNECT") return end("connect", { route: "CONNECT", intent, reason: decision.reason });
  if (decision.route === "UNSUPPORTED") return end("unsupported", { route: "UNSUPPORTED", intent, reason: decision.reason });
  if (decision.route === "CLARIFY") return end("clarify", { route: "CLARIFY", intent, reason: decision.question });

  const base = decision.route === "EXTEND" ? tools.find((t) => t.toolId === decision.toolId) : undefined;
  if (base && files.length === 0)
    emit({ t: "build.failed", stage: "understand", reason: `Attach the file ${base.name} works on so FORGE can test the new version against it.`, suggestions: [] });

  // ---- drafting ------------------------------------------------------------
  const exemplarPool = options.exemplars ?? EXEMPLARS;
  const retriever = new Retriever(exemplarPool, (e) => `${e.request} ${e.recipe.steps.map((s) => s.op).join(" ")}`);
  const columnText = Object.values(tables).flatMap((t) => t.columns).join(" ");
  const chosen = retriever.top(`${request} ${columnText}`, 3);
  const exemplarProfiles = (ex: Exemplar) => {
    const p: Record<string, TableProfile> = {};
    for (const [slot, f] of Object.entries(ex.files)) {
      try {
        p[slot] = profileTable(decode(f.text, (ex.recipe.inputs.find((i) => i.slot === slot)?.format ?? formatFromName(f.name) ?? "text") as Format).table);
      } catch {
        /* exemplar files are tested elsewhere */
      }
    }
    return p;
  };
  const draftCtx: DraftContext = {
    request,
    inputs: files.map((f) => ({ slot: f.slot, name: f.name, format: f.format, profile: profiles[f.slot], sample: tables[f.slot].rows })),
    exemplars: chosen.map((e) => exemplarBlock(e, exemplarProfiles(e))),
    base: base?.recipe,
    examples: examples.map((e) => `For input ${JSON.stringify(Object.fromEntries(Object.entries(e.input).map(([k, t]) => [k, t.rows])))} the file ${e.output} must be ${JSON.stringify(e.expected)}`),
  };
  const prompt = draftPrompt(draftCtx);
  const schema = recipeJsonSchema(files.map((f) => f.slot));
  const inputNames = files.map((f) => f.name);
  const realInputs: Inputs = { ...tables };
  const variants = [...makeVariants(realInputs), ...fuzzInputs(realInputs)];
  const temps = [0.2, 0.6, 0.8, 0.9, 1.0, 0.7, 0.5, 0.95];
  const candidates: Candidate[] = [];
  const members: Member[] = [];
  let repairs = 0;
  const maxRepairs = options.maxRepairs ?? Math.max(2, Math.ceil(K / 2));
  const controller = new AbortController();
  const outer = options.signal;
  const onOuterAbort = () => controller.abort();
  outer?.addEventListener("abort", onOuterAbort);
  const deadline = setTimeout(() => controller.abort(), budgetMs);
  let firstPreviewAt: number | undefined;
  let provisionalShown = false;
  let groups: Group[] = [];

  const flushers = new Map<string, { buf: string; at: number }>();
  const delta = (id: string, text: string) => {
    const f = flushers.get(id) ?? { buf: "", at: clock() };
    f.buf += text;
    if (f.buf.length >= 48 || clock() - f.at > 60) {
      emit({ t: "candidate.delta", id, text: f.buf });
      f.buf = "";
      f.at = clock();
    }
    flushers.set(id, f);
  };
  const flush = (id: string) => {
    const f = flushers.get(id);
    if (f?.buf) emit({ t: "candidate.delta", id, text: f.buf });
    flushers.delete(id);
  };

  const reject = (c: Candidate, stage: Candidate["stage"] & string, diagnostics: Diagnostic[], hint?: string) => {
    c.stage = stage;
    c.diagnostics = diagnostics;
    const d = diagnostics[0];
    emit({
      t: "candidate.rejected",
      id: c.id,
      stage: stage as never,
      reason: d ? formatDiagnostic(d) : stage,
      where: d?.where,
      hint: hint ?? d?.hint,
    });
  };

  const evaluate = (c: Candidate): boolean => {
    const parsed = parseRecipeText(c.text);
    if (!parsed.ok) {
      reject(c, "schema", parsed.diagnostics);
      return false;
    }
    c.recipe = parsed.recipe;
    emit({ t: "candidate.parsed", id: c.id, recipe: parsed.recipe, english: englishRecipe(parsed.recipe, (s) => tables[s]?.columns ?? []).map((l) => l.text) });
    let inputs: Inputs;
    try {
      inputs = loadInputs(parsed.recipe, files);
    } catch (error) {
      reject(c, "type", [{ code: "INPUT", where: "inputs", message: error instanceof Error ? error.message : "input could not be read" }]);
      return false;
    }
    const schemas = Object.fromEntries(Object.entries(inputs).map(([k, t]) => [k, schemaOf(profileTable(t))]));
    try {
      c.plan = compileRecipe(parsed.recipe, schemas, { now });
    } catch (error) {
      if (error instanceof RecipeError) {
        reject(c, error.diagnostics[0]?.code === "PARSE" ? "parse" : "type", error.diagnostics);
        return false;
      }
      throw error;
    }
    const aligned = alignShapes(c.recipe, c.plan, intentShapes);
    if (aligned.notes.length) {
      c.recipe = aligned.recipe;
      c.plan = compileRecipe(aligned.recipe, schemas, { now });
      for (const note of aligned.notes) emit({ t: "check.result", id: c.id, kind: "property", name: "Host repair: output shape", passed: true, detail: note });
      emit({ t: "candidate.parsed", id: c.id, recipe: aligned.recipe, english: englishRecipe(aligned.recipe, (s) => tables[s]?.columns ?? []).map((l) => l.text) });
    }
    const recipe = c.recipe;
    try {
      runPlan(c.plan, inputs, { now });
    } catch (error) {
      if (error instanceof RecipeRuntimeError) {
        reject(c, error.code.endsWith("BUDGET") ? "budget" : "runtime", [{ code: error.code, where: `steps[${error.step}]`, step: error.step, message: error.message.replace(/^step \d+: /, "") }]);
        return false;
      }
      throw error;
    }
    for (const ex of examples)
      if (!matchesExample(c.plan, ex, now)) {
        reject(c, "example", [{ code: "EXAMPLE", where: "outputs", message: `does not reproduce the confirmed example for ${ex.output}` }], "make the result match the confirmed example exactly");
        return false;
      }
    const props = checkProperties({ request, recipe, plan: c.plan, inputs, inputNames, profiles, variants, now, intentShapes });
    for (const p of props) emit({ t: "check.result", id: c.id, kind: "property", name: p.name, passed: p.passed, detail: p.detail });
    // A shape disagreement with the intent reading is worth a repair while
    // the budget lasts; after that the candidate stays, ranked lower.
    const shapeMiss = props.find((p) => !p.passed && p.name.startsWith("Shape matches"));
    if (shapeMiss) c.shapeMismatch = true;
    if (props.some((p) => !p.passed && p.name.endsWith("has rows on your data"))) c.emptyOnReal = true;
    const fatal = props.find((p) => !p.passed && p.fatal) ?? (shapeMiss && repairs < maxRepairs && c.attempt < 3 ? shapeMiss : undefined);
    if (fatal) {
      reject(c, "property", [{ code: "PROPERTY", where: "", message: `${fatal.name}: ${fatal.detail ?? "failed"}`, hint: fatal.hint }], fatal.hint);
      return false;
    }
    const t0 = clock();
    const behaviors: Behavior[] = [{ variant: "real", ...behave(c.plan, inputs, now) }];
    for (const v of variants) {
      // Variants were made from the auto-decoded tables; re-decode only when a path differs.
      behaviors.push({ variant: v.id, ...behave(c.plan, v.inputs, now) });
    }
    c.behaviors = behaviors;
    c.fingerprint = fingerprint(behaviors);
    c.executed = true;
    emit({ t: "candidate.executed", id: c.id, fingerprint: c.fingerprint, ms: Math.round(clock() - t0), outputs: recipe.outputs.filter((o) => o.kind === "file").map((o) => (o as { name: string }).name) });
    return true;
  };

  const preview = (c: Candidate, provisional: boolean) => {
    const inputs = loadInputs(c.recipe, files);
    const r = runPlan(c.plan!, inputs, { instrument: true, now });
    const english = englishRecipe(c.recipe!, (s) => inputs[s]?.columns ?? []).map((l) => l.text);
    const steps: StepPreview[] = (r.snapshots ?? []).map((s) => ({
      index: s.index,
      op: s.op,
      english: english[c.recipe!.inputs.length + s.index] ?? s.op,
      rowsIn: s.rowsIn,
      rowsOut: s.rowsOut,
      columns: s.columns,
      added: s.added,
      removed: s.removed,
      sample: s.sample.slice(0, 50),
      sampleLineage: s.sampleLineage?.slice(0, 50),
    }));
    const outputs: FilePreview[] = r.outputs
      .filter((o) => o.kind === "file")
      .map((o) => {
        const f = o as Extract<typeof o, { kind: "file" }>;
        return { name: f.name, format: f.format, bytes: f.bytes, text: f.text.slice(0, 65536), table: previewTable(f.table, 200, f.table.lin) };
      });
    for (const o of r.outputs)
      if (o.kind === "view")
        outputs.push({ name: `view:${o.output.type}`, format: "view", bytes: 0, text: JSON.stringify(o.output), table: previewTable(o.table, 200, o.table.lin) });
    emit({
      t: "preview.ready",
      candidate: c.id,
      provisional,
      recipe: c.recipe!,
      english,
      outputs,
      steps,
      inputs: Object.fromEntries(Object.entries(inputs).map(([k, t]) => [k, previewTable(t, 200)])),
      offsets: r.offsets,
    });
    if (firstPreviewAt === undefined) firstPreviewAt = clock() - started;
  };

  const runOne = async (index: number, parent?: Candidate, problems?: string[]): Promise<void> => {
    if (controller.signal.aborted) return;
    const id = parent ? `${parent.id}r${parent.attempt}` : `d${index + 1}`;
    const c: Candidate = { id, attempt: parent ? parent.attempt + 1 : 1, parent: parent?.id, temperature: parent ? 0.5 : temps[index % temps.length], seed: parent ? parent.seed + 1000 : index + 1, text: "", executed: false };
    candidates.push(c);
    emit({ t: "candidate.started", id, temperature: c.temperature, seed: c.seed, parent: c.parent, attempt: c.attempt });
    try {
      modelCalls++;
      const res = await options.transport.generate({
        purpose: parent ? "repair" : "draft",
        system: DRAFT_SYSTEM,
        prompt: parent ? repairPrompt(draftCtx, parent.text, problems ?? []) : prompt,
        schema,
        temperature: c.temperature,
        seed: c.seed,
        maxTokens: 900,
        signal: controller.signal,
        onDelta: (text) => delta(id, text),
      });
      promptTokens += res.promptTokens;
      completionTokens += res.completionTokens;
      modelMs += res.ms;
      c.text = res.text;
    } catch (error) {
      flush(id);
      if (error instanceof AbortedError || controller.signal.aborted) {
        c.stage = "stopped";
        emit({ t: "candidate.rejected", id, stage: "budget", reason: settled(groups) ? "not needed: three drafts already agree" : "stopped at the time budget" });
        return;
      }
      reject(c, "schema", [{ code: "MODEL", where: "", message: error instanceof Error ? error.message : "the model did not answer" }]);
      return;
    }
    flush(id);
    const ok = evaluate(c);
    if (!ok && c.diagnostics && repairs < maxRepairs && c.attempt < 3 && !controller.signal.aborted && c.stage !== "example") {
      repairs++;
      const problems2 = c.diagnostics.slice(0, 3).map((d) => formatDiagnostic(d) + (d.expr ? ` in \`${d.expr}\`` : ""));
      await runOne(index, c, problems2);
      return;
    }
    if (!ok) return;
    members.push({ id: c.id, fingerprint: c.fingerprint!, behaviors: c.behaviors! });
    groups = clusterize(members);
    if (!provisionalShown) {
      provisionalShown = true;
      preview(c, true);
    }
    if (settled(groups)) controller.abort();
  };

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, K));
  let next = 0;
  const worker = async () => {
    while (next < K && !controller.signal.aborted) {
      const i = next++;
      await runOne(i);
    }
  };
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    clearTimeout(deadline);
    outer?.removeEventListener("abort", onOuterAbort);
  }
  if (outer?.aborted) return end("cancelled", { route: decision.route, candidates });

  // ---- consensus -----------------------------------------------------------
  groups = clusterize(members);
  // Prefer behavior that agrees with the separate intent reading of the output shape.
  // and that produces something on the user's data. Size breaks ties.
  const rep0 = (g: Group) => candidates.find((c) => c.id === g.members[0]);
  const merit = (g: Group) => (rep0(g)?.shapeMismatch ? 0 : 2) + (rep0(g)?.emptyOnReal ? 0 : 1);
  groups = [...groups].sort((a, b) => merit(b) - merit(a) || b.members.length - a.members.length);
  const attempted = candidates.filter((c) => !c.parent && c.stage !== "stopped").length;
  const verdict = decide(groups);
  const label = (g?: Group) => (g ? `${g.members.length} of ${attempted} draft${attempted === 1 ? "" : "s"} agree${g.members.length === 1 ? "s" : ""}` : `0 of ${attempted} drafts passed`);
  stats();
  if (verdict.kind === "none") {
    emit({ t: "consensus.formed", clusters: [], agreement: label(), total: attempted });
    const closest = [...candidates].sort((a, b) => rank(b) - rank(a))[0];
    const why = closest?.diagnostics?.[0];
    emit({
      t: "build.failed",
      stage: "test",
      reason: why ? `No draft passed every check. The closest one failed because ${formatDiagnostic(why)}.` : "No draft passed every check.",
      closest: closest?.id,
      suggestions: ["Retry with more drafts", "Simplify the request into one result", "Give an example of the result you expect"],
    });
    emit({ t: "build.ended", outcome: "failed", ms: Math.round(clock() - started) });
    return { outcome: "failed", route: decision.route, candidates, clusters: groups, modelCalls, examples, ms: clock() - started, tables, files, intent, reason: why ? formatDiagnostic(why) : "no candidate passed" };
  }
  let winnerGroup: Group = verdict.kind === "winner" ? verdict.group : verdict.groups[0];
  let ambiguity: CrucibleResult["ambiguity"];
  if (verdict.kind === "split") {
    const [a, b] = verdict.groups;
    const ca = candidates.find((c) => c.id === a.members[0])!;
    const cb = candidates.find((c) => c.id === b.members[0])!;
    const diff = distinguishing(ca.plan!, cb.plan!, [{ id: "real", label: "your data", inputs: realInputs }, ...variants], now);
    if (diff) {
      const options2: AmbiguityOption[] = [a, b].map((g) => {
        const c = candidates.find((x) => x.id === g.members[0])!;
        const r = runPlan(c.plan!, diff.variant.inputs, { now });
        const f = r.outputs.find((o) => o.kind === "file") as Extract<(typeof r.outputs)[number], { kind: "file" }> | undefined;
        return { cluster: g.id, candidate: c.id, english: englishRecipe(c.recipe!).map((l) => l.text), output: f ? previewTable(f.table) : { columns: [], rows: [], total: 0 } };
      });
      emit({ t: "consensus.formed", clusters: groups.map((g) => ({ id: g.id, members: g.members, fingerprint: g.fingerprint, size: g.members.length })), agreement: `${a.members.length} and ${b.members.length} of ${attempted} drafts read it differently`, total: attempted });
      emit({
        t: "ambiguity.found",
        question: "Two readings of your request give different results here. Which did you mean?",
        input: Object.fromEntries(Object.entries(diff.variant.inputs).map(([k, t]) => [k, previewTable(t)])),
        options: options2,
      });
      const answer = options.ask ? await options.ask({ options: options2 }) : undefined;
      const pick = answer ? groups.find((g) => g.id === answer.cluster) : undefined;
      winnerGroup = pick ?? a;
      ambiguity = { asked: !!options.ask, chosen: winnerGroup.id };
      emit({ t: "ambiguity.resolved", cluster: winnerGroup.id, candidate: winnerGroup.members[0] });
      if (pick) {
        const chosenCandidate = candidates.find((x) => x.id === pick.members[0])!;
        const r = runPlan(chosenCandidate.plan!, diff.variant.inputs, { now });
        const f = r.outputs.find((o) => o.kind === "file") as Extract<(typeof r.outputs)[number], { kind: "file" }> | undefined;
        if (f) {
          const example: Example = {
            id: `ex${examples.length + 1}`,
            kind: "choice",
            input: Object.fromEntries(Object.entries(diff.variant.inputs).map(([k, t]) => [k, previewTable(t)])),
            output: f.name,
            expected: f.value !== undefined ? f.value : f.table.rows.map((row) => Object.fromEntries(f.table.columns.map((c) => [c, row[c] ?? null]))),
            note: "chosen when two readings disagreed",
          };
          examples.push(example);
          emit({ t: "example.added", example });
        }
      }
    } else winnerGroup = a;
  }
  if (!ambiguity)
    emit({
      t: "consensus.formed",
      clusters: groups.map((g) => ({ id: g.id, members: g.members, fingerprint: g.fingerprint, size: g.members.length })),
      winner: winnerGroup.members[0],
      agreement: label(winnerGroup),
      total: attempted,
    });
  else
    emit({
      t: "consensus.formed",
      clusters: groups.map((g) => ({ id: g.id, members: g.members, fingerprint: g.fingerprint, size: g.members.length })),
      winner: winnerGroup.members[0],
      agreement: `you chose: ${winnerGroup.members.length} of ${attempted} drafts`,
      total: attempted,
    });

  // ---- preview, verification, review ------------------------------------------
  // The representative is the lowest-temperature member: the most conservative draft.
  const winner = winnerGroup.members.map((id) => candidates.find((c) => c.id === id)!).sort((x, y) => x.temperature - y.temperature)[0];
  preview(winner, false);
  const lowered = options.lower?.(winner.recipe!, winner.plan!);
  const checkInputs = [loadInputs(winner.recipe, files), ...variants.map((v) => v.inputs)];
  const extra = options.verify ? await options.verify(winner.recipe!, winner.plan!, checkInputs) : [];
  for (const x of extra) emit({ t: "check.result", id: winner.id, kind: x.kind, name: x.name, passed: x.passed, detail: x.detail });
  const hash = recipeHash(winner.recipe!, lowered?.irHash);
  const grants = defaultGrants(winner.recipe!, Object.fromEntries(files.map((f) => [f.slot, f.name])));
  const previous = base ? defaultGrants(base.recipe) : undefined;
  const failedChecks = extra.filter((x) => !x.passed).length;
  emit({
    t: "review.ready",
    candidate: winner.id,
    hash,
    irHash: lowered?.irHash,
    passport: passportFor(grants, previous),
    typescript: lowered?.typescript,
    ir: lowered?.ir as never,
    checks: { passed: extra.length - failedChecks, failed: failedChecks },
  });
  const english = englishRecipe(winner.recipe!, (s) => tables[s]?.columns ?? []).map((l) => l.text);
  const result: CrucibleResult = {
    outcome: "review",
    route: decision.route,
    winner: { recipe: winner.recipe!, plan: winner.plan!, hash, title: intent.title, description: intent.restatement, english, agreement: label(winnerGroup) },
    candidates,
    clusters: groups,
    modelCalls,
    examples,
    timeToPreviewMs: firstPreviewAt,
    ms: clock() - started,
    tables,
    files,
    intent,
    ambiguity,
  };
  stats();
  emit({ t: "build.ended", outcome: "review", ms: Math.round(clock() - started) });
  return result;
}

function rank(c: Candidate): number {
  const order = ["stopped", "schema", "parse", "type", "budget", "runtime", "example", "property"];
  return c.executed ? 99 : order.indexOf(c.stage ?? "schema");
}
