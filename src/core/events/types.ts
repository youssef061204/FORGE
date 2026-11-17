/**
 * Every build is an ordered stream of typed events. The UI is a pure reducer
 * over this stream, so a live build, a recorded tape, a scripted tape and a
 * failed benchmark mission all render through the same components.
 */
import type { ColumnProfile } from "../profile";
import type { Recipe } from "../recipe/schema";
import type { Json, Row } from "../table";
import type { CapabilityId } from "../contracts/capabilities";
import type { Passport } from "../contracts/passport";

export type Provenance = "live" | "recorded" | "scripted";
export type Route = "SYNTHESIZE" | "REUSE" | "EXTEND" | "CONNECT" | "CLARIFY" | "UNSUPPORTED";
export type RejectStage = "schema" | "parse" | "type" | "budget" | "runtime" | "property" | "example" | "differential";
export type CheckKind = "type" | "property" | "fuzz" | "differential" | "example" | "replay";

export type InputRef = { slot: string; name: string; format: string; rows: number; bytes: number };
export type PreviewTable = { columns: string[]; rows: Row[]; total: number; lineage?: number[][] };
export type FilePreview = { name: string; format: string; bytes: number; text: string; table: PreviewTable };
export type StepPreview = {
  index: number;
  op: string;
  english: string;
  rowsIn: number;
  rowsOut: number;
  columns: string[];
  added: string[];
  removed: string[];
  sample: Row[];
  sampleLineage?: number[][];
};
export type Cluster = { id: string; members: string[]; fingerprint: string; size: number; sample?: string };
export type AmbiguityOption = { cluster: string; candidate: string; english: string[]; output: PreviewTable };
export type Example = {
  id: string;
  kind: "expected-output" | "remove-row" | "edit-cell" | "choice";
  input: Record<string, PreviewTable>;
  output: string;
  expected: Json;
  note: string;
};

type EventBody =
  | {
      t: "build.started";
      request: string;
      provenance: Provenance;
      model?: string;
      hardware?: string;
      recordedAt?: string;
      inputs: InputRef[];
      drafts: number;
      budgetMs: number;
    }
  | { t: "profile.ready"; slot: string; name: string; rows: number; columns: ColumnProfile[]; sample: Row[] }
  | { t: "intent.ready"; title: string; restatement: string; outputs: string[]; needs: CapabilityId[]; ms: number }
  | { t: "route.decided"; route: Route; reason: string; missing?: CapabilityId[]; toolId?: string; question?: string }
  | { t: "candidate.started"; id: string; temperature: number; seed: number; parent?: string; attempt: number }
  | { t: "candidate.delta"; id: string; text: string }
  | { t: "candidate.parsed"; id: string; recipe: Recipe; english: string[] }
  | {
      t: "candidate.rejected";
      id: string;
      stage: RejectStage;
      reason: string;
      where?: string;
      hint?: string;
    }
  | { t: "candidate.executed"; id: string; fingerprint: string; ms: number; outputs: string[] }
  | { t: "check.result"; id?: string; kind: CheckKind; name: string; passed: boolean; detail?: string }
  | { t: "consensus.formed"; clusters: Cluster[]; winner?: string; agreement: string; total: number }
  | { t: "ambiguity.found"; question: string; input: Record<string, PreviewTable>; options: AmbiguityOption[] }
  | { t: "ambiguity.resolved"; cluster: string; candidate: string }
  | { t: "example.added"; example: Example }
  | {
      t: "preview.ready";
      candidate: string;
      provisional: boolean;
      recipe: Recipe;
      english: string[];
      outputs: FilePreview[];
      steps: StepPreview[];
      inputs: Record<string, PreviewTable>;
      offsets: Record<string, number>;
    }
  | {
      t: "review.ready";
      candidate: string;
      hash: string;
      irHash?: string;
      passport: Passport;
      typescript?: string;
      ir?: Json;
      checks: { passed: number; failed: number };
    }
  | { t: "approved"; hash: string; grants: string[] }
  | { t: "installed"; toolId: string; version: number; name: string }
  | { t: "model.stats"; calls: number; promptTokens: number; completionTokens: number; ms: number }
  | {
      t: "build.failed";
      stage: string;
      reason: string;
      closest?: string;
      suggestions: string[];
    }
  | {
      t: "build.ended";
      outcome: "review" | "installed" | "failed" | "connect" | "clarify" | "unsupported" | "cancelled" | "reuse";
      ms: number;
    };

export type BuildEvent = { buildId: string; seq: number; atMs: number } & EventBody;
export type BuildEventBody = EventBody;
export type BuildEventType = BuildEvent["t"];

export const TAPE_FORMAT = "forge-tape/1";
export type Tape = {
  format: typeof TAPE_FORMAT;
  id: string;
  title: string;
  provenance: Exclude<Provenance, "live">;
  /** For recorded tapes: what generated it, where and when. */
  model?: string;
  hardware?: string;
  recordedAt?: string;
  commit?: string;
  request: string;
  /** Input files so a viewer can re-run the result in their own browser. */
  files: { slot: string; name: string; format: string; text: string }[];
  events: BuildEvent[];
};
