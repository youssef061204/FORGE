/** Reads committed evaluation results. The Scorecard and README numbers come only from here. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Summary = {
  corpus: string;
  corpusHash: string;
  model: string;
  hardware: string;
  commit: string;
  dirty: boolean;
  date: string;
  drafts: number;
  n: number;
  passed: number;
  passRate: number;
  interval95: [number, number];
  verifiedFalseSuccess: number;
  decisions?: { n: number; correct: number };
  firstPreviewCorrect?: number;
  clarified?: number;
  byPhrasing?: Record<string, { n: number; passed: number }>;
  byCategory?: Record<string, { n: number; passed: number }>;
  timeToPreviewP50Ms: number | null;
  timeToPreviewP95Ms: number | null;
  totalP50Ms: number | null;
  modelCalls: number;
  command: string;
};
export type MissionResult = { id: string; category: string; phrasing?: string; status: string; why?: string; route: string; ms: number; timeToPreviewMs?: number; agreement?: string; candidates?: number };
export type RunFile = { dir: string; summary: Summary; results: MissionResult[]; tapes: string[] };

const ROOT = join(process.cwd(), "evaluation", "results");

export function runs(): RunFile[] {
  if (!existsSync(ROOT)) return [];
  const out: RunFile[] = [];
  for (const dir of readdirSync(ROOT).sort()) {
    for (const corpus of ["dev", "validation", "holdout"]) {
      const p = join(ROOT, dir, `${corpus}.json`);
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, "utf8"));
      const tapesDir = join(ROOT, dir, "tapes");
      out.push({ dir, summary: data.summary, results: data.results, tapes: existsSync(tapesDir) ? readdirSync(tapesDir).map((f) => f.replace(/\.json$/, "")) : [] });
    }
  }
  return out;
}

export function latest(corpus: string): RunFile | undefined {
  return runs()
    .filter((r) => r.summary.corpus === corpus && !r.summary.dirty)
    .sort((a, b) => a.summary.date.localeCompare(b.summary.date))
    .at(-1);
}

export function legacyBaseline() {
  const p = join(ROOT, "2026-11-17-c8b172f-legacy-baseline", "result.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as { summary: { recorded: number; passed: number; p50Ms: number }; model: string; commit: string; previouslyPublished: string }) : undefined;
}

export function tape(dir: string, id: string): unknown | undefined {
  if (!/^[\w.-]+$/.test(dir) || !/^[\w.-]+$/.test(id)) return undefined;
  const p = join(ROOT, dir, "tapes", `${id}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
}
