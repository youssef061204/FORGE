/** A pure reducer from build events to the state every Forge Floor view renders. */
import type {
  AmbiguityOption,
  BuildEvent,
  CheckKind,
  Cluster,
  Example,
  FilePreview,
  InputRef,
  PreviewTable,
  Provenance,
  RejectStage,
  Route,
  StepPreview,
} from "./types";
import type { ColumnProfile } from "../profile";
import type { Recipe } from "../recipe/schema";
import type { Row, Json } from "../table";
import type { Passport } from "../contracts/passport";
import type { CapabilityId } from "../contracts/capabilities";

export const STAGES = ["understand", "draft", "test", "choose", "preview", "approve", "installed"] as const;
export type Stage = (typeof STAGES)[number];

export type CandidateView = {
  id: string;
  temperature: number;
  seed: number;
  parent?: string;
  attempt: number;
  status: "drafting" | "parsed" | "rejected" | "executed" | "winner" | "outvoted";
  text: string;
  recipe?: Recipe;
  english?: string[];
  reject?: { stage: RejectStage; reason: string; where?: string; hint?: string };
  fingerprint?: string;
  cluster?: string;
  checks: { kind: CheckKind; name: string; passed: boolean; detail?: string }[];
  ms?: number;
};

export type BuildView = {
  id: string;
  request: string;
  provenance: Provenance;
  model?: string;
  hardware?: string;
  recordedAt?: string;
  inputs: InputRef[];
  drafts: number;
  budgetMs: number;
  stage: Stage;
  /** Highest stage reached, for the stage line. */
  reached: number;
  profiles: Record<string, { name: string; rows: number; columns: ColumnProfile[]; sample: Row[] }>;
  intent?: { title: string; restatement: string; outputs: string[]; needs: CapabilityId[] };
  route?: { route: Route; reason: string; missing?: CapabilityId[]; toolId?: string; question?: string };
  candidates: Record<string, CandidateView>;
  order: string[];
  checks: { id?: string; kind: CheckKind; name: string; passed: boolean; detail?: string }[];
  consensus?: { clusters: Cluster[]; winner?: string; agreement: string; total: number };
  ambiguity?: { question: string; input: Record<string, PreviewTable>; options: AmbiguityOption[]; resolved?: string };
  examples: Example[];
  preview?: {
    candidate: string;
    provisional: boolean;
    recipe: Recipe;
    english: string[];
    outputs: FilePreview[];
    steps: StepPreview[];
    inputs: Record<string, PreviewTable>;
    offsets: Record<string, number>;
  };
  review?: { candidate: string; hash: string; irHash?: string; passport: Passport; typescript?: string; ir?: Json; checks: { passed: number; failed: number } };
  approved?: { hash: string; grants: string[] };
  installed?: { toolId: string; version: number; name: string };
  failure?: { stage: string; reason: string; closest?: string; suggestions: string[] };
  outcome?: string;
  stats?: { calls: number; promptTokens: number; completionTokens: number; ms: number };
  elapsedMs: number;
  events: number;
  lastSeq: number;
};

export function emptyBuild(id = ""): BuildView {
  return {
    id,
    request: "",
    provenance: "scripted",
    inputs: [],
    drafts: 0,
    budgetMs: 0,
    stage: "understand",
    reached: 0,
    profiles: {},
    candidates: {},
    order: [],
    checks: [],
    examples: [],
    elapsedMs: 0,
    events: 0,
    lastSeq: -1,
  };
}

function advance(view: BuildView, stage: Stage): BuildView {
  const index = STAGES.indexOf(stage);
  return { ...view, stage, reached: Math.max(view.reached, index) };
}

function patchCandidate(view: BuildView, id: string, patch: Partial<CandidateView>): BuildView {
  const current = view.candidates[id];
  if (!current) return view;
  return { ...view, candidates: { ...view.candidates, [id]: { ...current, ...patch } } };
}

export function reduce(view: BuildView, e: BuildEvent): BuildView {
  if (e.seq <= view.lastSeq) return view; // duplicate delivery (SSE resume)
  let v: BuildView = { ...view, events: view.events + 1, lastSeq: e.seq, elapsedMs: Math.max(view.elapsedMs, e.atMs), id: e.buildId };
  switch (e.t) {
    case "build.started":
      return {
        ...v,
        request: e.request,
        provenance: e.provenance,
        model: e.model,
        hardware: e.hardware,
        recordedAt: e.recordedAt,
        inputs: e.inputs,
        drafts: e.drafts,
        budgetMs: e.budgetMs,
        stage: "understand",
      };
    case "profile.ready":
      return { ...v, profiles: { ...v.profiles, [e.slot]: { name: e.name, rows: e.rows, columns: e.columns, sample: e.sample } } };
    case "intent.ready":
      return { ...v, intent: { title: e.title, restatement: e.restatement, outputs: e.outputs, needs: e.needs } };
    case "route.decided":
      return { ...v, route: { route: e.route, reason: e.reason, missing: e.missing, toolId: e.toolId, question: e.question } };
    case "candidate.started":
      v = advance(v, v.reached > STAGES.indexOf("draft") ? v.stage : "draft");
      return {
        ...v,
        order: v.order.includes(e.id) ? v.order : [...v.order, e.id],
        candidates: {
          ...v.candidates,
          [e.id]: { id: e.id, temperature: e.temperature, seed: e.seed, parent: e.parent, attempt: e.attempt, status: "drafting", text: "", checks: [] },
        },
      };
    case "candidate.delta": {
      const c = v.candidates[e.id];
      return c ? patchCandidate(v, e.id, { text: c.text + e.text }) : v;
    }
    case "candidate.parsed":
      return patchCandidate(v, e.id, { status: "parsed", recipe: e.recipe, english: e.english });
    case "candidate.rejected":
      return patchCandidate(v, e.id, { status: "rejected", reject: { stage: e.stage, reason: e.reason, where: e.where, hint: e.hint } });
    case "candidate.executed":
      v = advance(v, v.reached > STAGES.indexOf("test") ? v.stage : "test");
      return patchCandidate(v, e.id, { status: "executed", fingerprint: e.fingerprint, ms: e.ms });
    case "check.result": {
      v = { ...v, checks: [...v.checks, { id: e.id, kind: e.kind, name: e.name, passed: e.passed, detail: e.detail }] };
      if (e.id && v.candidates[e.id])
        v = patchCandidate(v, e.id, { checks: [...v.candidates[e.id].checks, { kind: e.kind, name: e.name, passed: e.passed, detail: e.detail }] });
      return v;
    }
    case "consensus.formed": {
      v = advance(v, "choose");
      const candidates = { ...v.candidates };
      for (const cluster of e.clusters)
        for (const id of cluster.members)
          if (candidates[id])
            candidates[id] = {
              ...candidates[id],
              cluster: cluster.id,
              status: e.winner && cluster.members.includes(e.winner) ? "winner" : candidates[id].status === "rejected" ? "rejected" : "outvoted",
            };
      return { ...v, candidates, consensus: { clusters: e.clusters, winner: e.winner, agreement: e.agreement, total: e.total } };
    }
    case "ambiguity.found":
      return { ...advance(v, "choose"), ambiguity: { question: e.question, input: e.input, options: e.options } };
    case "ambiguity.resolved":
      return v.ambiguity ? { ...v, ambiguity: { ...v.ambiguity, resolved: e.cluster } } : v;
    case "example.added":
      return { ...v, examples: [...v.examples, e.example] };
    case "preview.ready":
      return {
        ...advance(v, "preview"),
        preview: {
          candidate: e.candidate,
          provisional: e.provisional,
          recipe: e.recipe,
          english: e.english,
          outputs: e.outputs,
          steps: e.steps,
          inputs: e.inputs,
          offsets: e.offsets,
        },
      };
    case "review.ready":
      return { ...advance(v, "approve"), review: { candidate: e.candidate, hash: e.hash, irHash: e.irHash, passport: e.passport, typescript: e.typescript, ir: e.ir, checks: e.checks } };
    case "approved":
      return { ...v, approved: { hash: e.hash, grants: e.grants } };
    case "installed":
      return { ...advance(v, "installed"), installed: { toolId: e.toolId, version: e.version, name: e.name } };
    case "model.stats":
      return { ...v, stats: { calls: e.calls, promptTokens: e.promptTokens, completionTokens: e.completionTokens, ms: e.ms } };
    case "build.failed":
      return { ...v, failure: { stage: e.stage, reason: e.reason, closest: e.closest, suggestions: e.suggestions } };
    case "build.ended":
      return { ...v, outcome: e.outcome };
  }
  return v;
}

export function replay(events: BuildEvent[], id = events[0]?.buildId ?? ""): BuildView {
  return events.reduce(reduce, emptyBuild(id));
}
