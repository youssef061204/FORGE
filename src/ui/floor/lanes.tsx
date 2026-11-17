"use client";
import type { BuildView, CandidateView } from "@/core/events/reducer";
import { Eyebrow, Explain, Panel, Term, cx } from "../primitives";

const CLUSTER_TINT = ["border-steel/60", "border-brass/60", "border-[#8a7fb0]/60", "border-[#6fa38c]/60"];

/** Pull recognizable steps out of partial JSON while a draft is still streaming. */
function partialSteps(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\{"op"\s*:\s*"(\w+)"([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}?/g)) {
    const op = m[1];
    const body = m[2];
    const first = /"(?:where|set|columns|by|with|column|pattern|n|map)"\s*:\s*(\{[^}]*\}?|\[[^\]]*\]?|"[^"]*"?|\d+)/.exec(body)?.[1] ?? "";
    out.push(`${op} ${first.replace(/[{}[\]"]/g, "").replace(/:/g, " = ").slice(0, 60)}`.trim());
  }
  return out;
}

function Lane({ c, clusterIndex, explainWinner }: { c: CandidateView; clusterIndex: number; explainWinner?: string }) {
  const drafting = c.status === "drafting";
  const steps = c.english ?? partialSteps(c.text);
  const failedChecks = c.checks.filter((k) => !k.passed);
  const stopped = c.reject?.stage === "budget" && /not needed|time budget/.test(c.reject.reason);
  return (
    <li
      className={cx(
        "flex min-h-[220px] flex-col rounded-2xl border bg-coal/80 p-4 transition-all duration-500 ease-[var(--ease-forge)]",
        drafting && "border-molten/50 shadow-[0_0_40px_-20px_rgb(255_106_31/0.8)]",
        c.status === "rejected" && !stopped && "border-slag/40 opacity-70",
        stopped && "border-line opacity-50",
        (c.status === "executed" || c.status === "outvoted") && (clusterIndex >= 0 ? CLUSTER_TINT[clusterIndex % 4] : "border-steel/40"),
        c.status === "winner" && "border-steel-hi/70 shadow-[0_0_0_1px_rgb(212_227_238/0.15)]",
        c.status === "outvoted" && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] text-dim">
          {c.parent ? `repair of ${c.parent}` : `draft ${c.id.replace(/^d/, "")}`}
          <span className="ml-2 text-faint">t={c.temperature}</span>
        </span>
        <StatusChip c={c} stopped={stopped} />
      </div>
      <ol className="mt-3 flex-1 space-y-1.5 text-[13px] leading-snug">
        {steps.map((s, i) => (
          <li key={i} className={cx("flex gap-2", drafting ? "text-amber" : "text-paper/85")}>
            <span className="num w-4 shrink-0 text-faint">{i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
        {drafting && !steps.length && c.text && <li className="break-all font-mono text-[11px] leading-snug text-amber/60">{c.text.slice(-160)}</li>}
        {drafting && <li aria-hidden className="ml-6 h-3 w-2 bg-amber ember" />}
        {!steps.length && !drafting && !c.reject && <li className="text-faint">…</li>}
      </ol>
      {c.reject && !stopped && (
        <p className="mt-3 rounded-lg bg-slag-deep/60 px-3 py-2 text-[12.5px] leading-snug text-[#f1a99b]">
          {c.reject.reason}
          {c.reject.hint && <span className="mt-1 block text-[#d8968a]">Hint for repair: {c.reject.hint}</span>}
        </p>
      )}
      {stopped && <p className="mt-3 text-[12px] text-faint">{c.reject!.reason}</p>}
      {c.status !== "drafting" && c.checks.length > 0 && (
        <p className="mt-3 text-[12px] text-faint">
          {c.checks.length - failedChecks.length}/{c.checks.length} checks passed
          {c.status === "winner" && explainWinner ? ` · ${explainWinner}` : ""}
        </p>
      )}
    </li>
  );
}

function StatusChip({ c, stopped }: { c: CandidateView; stopped: boolean }) {
  const map: Record<string, [string, string]> = {
    drafting: ["writing", "text-amber"],
    parsed: ["testing", "text-amber"],
    rejected: [stopped ? "stopped" : "rejected", stopped ? "text-faint" : "text-[#f1a99b]"],
    executed: ["passed", "text-steel-hi"],
    winner: ["chosen", "text-steel-hi"],
    outvoted: ["outvoted", "text-dim"],
  };
  const [label, color] = map[c.status];
  return <span className={cx("text-[11px] font-semibold uppercase tracking-[0.14em]", color)}>{label}</span>;
}

export function Lanes({ view, explain }: { view: BuildView; explain: boolean }) {
  const ids = view.order;
  const clusters = view.consensus?.clusters ?? [];
  const clusterOf = (id: string) => clusters.findIndex((cl) => cl.members.includes(id));
  return (
    <div className="grid gap-4">
      <Explain show={explain}>
        A small model is right about half the time, so FORGE writes several <Term term="draft">drafts</Term> at once and tests every one on your real data and on tricky variants of it:
        empty files, doubled rows, shuffled rows, blank cells, odd punctuation. Drafts that behave identically are grouped.
      </Explain>
      {view.consensus && (
        <Panel tone={view.consensus.winner ? "steel" : "slag"} className="flex flex-wrap items-center gap-4 p-4">
          <div>
            <Eyebrow>Agreement</Eyebrow>
            <div className="font-display text-2xl font-semibold text-steel-hi">{view.consensus.agreement}</div>
          </div>
          <p className="max-w-xl text-[14px] text-dim">Agreement means these drafts produced identical results on every test input. It is evidence, not proof: you check the result next.</p>
        </Panel>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-live="polite">
        {ids.map((id) => (
          <Lane key={id} c={view.candidates[id]} clusterIndex={clusterOf(id)} />
        ))}
      </ul>
    </div>
  );
}
