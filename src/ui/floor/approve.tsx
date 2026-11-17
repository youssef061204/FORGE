"use client";
import Link from "next/link";
import type { BuildView } from "@/core/events/reducer";
import { formatBytes } from "@/core/contracts/passport";
import { Button, Eyebrow, Explain, HoldSeal, Panel, Term } from "../primitives";

export function Passport({ view, onApprove, readOnly, explain }: { view: BuildView; onApprove?: () => void; readOnly?: boolean; explain: boolean }) {
  const r = view.review!;
  const pp = r.passport;
  return (
    <div className="grid gap-4">
      <Explain show={explain}>
        Nothing runs until you approve it. The <Term term="permission">permission</Term> card is generated from the program, and approval binds to its exact <Term term="hash">fingerprint</Term>: any change needs a new approval.
      </Explain>
      <Panel tone="brass" className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-brass/25 bg-brass/5 p-5">
          <div>
            <Eyebrow className="text-brass-hi">Permission passport</Eyebrow>
            <h3 className="mt-1 font-display text-2xl font-semibold">{view.intent?.title ?? "New tool"}</h3>
            <p className="num mt-1 text-[12px] text-faint" title={r.hash}>
              program {r.hash.slice(0, 12)}…{r.irHash ? ` · forge-ir ${r.irHash.slice(0, 8)}` : ""}
            </p>
          </div>
          <span className="rounded-full border border-steel/40 px-3 py-1 text-[12px] text-steel-hi">{pp.executes === "recipe" ? "Recipe · no model-written code runs" : "Custom code · runs in a locked jail"}</span>
        </div>
        <div className="grid gap-6 p-5 md:grid-cols-2">
          <div>
            <Eyebrow>It may</Eyebrow>
            <ul className="mt-2 space-y-2">
              {pp.can.map((c, i) => (
                <li key={i} className="flex gap-3 text-[15px]">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-sm bg-brass" />
                  {c.text}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <Eyebrow>It cannot</Eyebrow>
            <ul className="mt-2 space-y-2">
              {pp.cannot.map((c, i) => (
                <li key={i} className="flex gap-3 text-[15px] text-dim">
                  <span aria-hidden className="mt-0.5 text-slag">✕</span>
                  {c}
                </li>
              ))}
            </ul>
            <p className="num mt-3 text-[12px] text-faint">
              Limits: {formatBytes(pp.limits.maxInputBytes)} in · {pp.limits.maxRows.toLocaleString()} rows · {pp.limits.maxMs / 1000} s
            </p>
          </div>
        </div>
        {pp.delta && (pp.delta.added.length > 0 || pp.delta.removed.length > 0) && (
          <div className="border-t border-brass/25 p-5">
            <Eyebrow>Changed since the previous version</Eyebrow>
            <ul className="mt-2 space-y-1 text-[14px]">
              {pp.delta.added.map((d) => (
                <li key={d} className="text-amber">+ {d}</li>
              ))}
              {pp.delta.removed.map((d) => (
                <li key={d} className="text-dim">− {d}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4 border-t border-brass/25 p-5">
          {view.approved ? (
            <HoldSeal onSealed={() => undefined} disabled label="Approved" />
          ) : readOnly ? (
            <p className="text-[14px] text-dim">Approval happens only on your own FORGE, by you. This is a recording.</p>
          ) : (
            <HoldSeal onSealed={() => onApprove?.()} />
          )}
          <p className="max-w-sm text-[13px] text-faint">{r.checks.failed ? `${r.checks.failed} extra check(s) failed; see under the hood.` : "Every check passed."} An assistant can ask for tools, but only you can approve one.</p>
        </div>
      </Panel>
    </div>
  );
}

export function Installed({ view, showcase }: { view: BuildView; showcase?: boolean }) {
  const t = view.installed!;
  return (
    <Panel tone="steel" className="p-6">
      <Eyebrow>Installed</Eyebrow>
      <h3 className="mt-1 font-display text-3xl font-semibold cooling">{t.name}</h3>
      <p className="mt-2 max-w-prose text-dim">
        Version {t.version} is in your Toolbox. Any connected MCP assistant now sees it in its tool list and can call it, inside the permissions you approved.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {!showcase && (
          <Link href={`/tools/${t.toolId}`}>
            <Button tone="molten">Run it</Button>
          </Link>
        )}
        <Link href="/assistants">
          <Button>Connect an assistant</Button>
        </Link>
      </div>
    </Panel>
  );
}

export function Failure({ view, onRetry, onSimplify }: { view: BuildView; onRetry?: (drafts: number) => void; onSimplify?: () => void }) {
  const f = view.failure!;
  const closest = f.closest ? view.candidates[f.closest] : undefined;
  return (
    <Panel tone="slag" className="p-6">
      <Eyebrow className="text-[#f1a99b]">Not built</Eyebrow>
      <h3 className="mt-1 font-display text-2xl font-semibold">{f.reason}</h3>
      {closest?.english && (
        <div className="mt-4 rounded-xl border border-line p-3">
          <Eyebrow className="mb-1">The closest draft</Eyebrow>
          <ol className="space-y-0.5 text-[13px] text-dim">
            {closest.english.map((l, i) => (
              <li key={i}>
                {i + 1}. {l}
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className="mt-4 text-[14px] text-faint">Nothing was installed and nothing was written. Three ways forward:</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <Button tone="molten" onClick={() => onRetry?.(8)} disabled={!onRetry}>
          Retry with more drafts
        </Button>
        <Button onClick={onSimplify} disabled={!onSimplify}>
          Simplify the request
        </Button>
        <Button onClick={onSimplify} disabled={!onSimplify}>
          Give an example of the result
        </Button>
      </div>
    </Panel>
  );
}

export function Hood({ view, events }: { view: BuildView; events: { seq: number; atMs: number; t: string }[] }) {
  return (
    <details className="group rounded-2xl border border-line bg-coal/60">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3 text-[14px] text-dim hover:text-paper">
        <span>Under the hood</span>
        <span className="num text-[12px] text-faint">
          {view.events} events{view.stats ? ` · ${view.stats.calls} model calls · ${view.stats.completionTokens.toLocaleString()} tokens out` : ""}
        </span>
      </summary>
      <div className="grid gap-4 border-t border-line p-5 lg:grid-cols-2">
        <div className="min-w-0">
          <Eyebrow className="mb-2">Event log</Eyebrow>
          <ol className="max-h-80 overflow-auto rounded-lg bg-ink p-3 font-mono text-[12px] leading-relaxed text-dim">
            {events
              .filter((e) => e.t !== "candidate.delta")
              .map((e) => (
                <li key={e.seq}>
                  <span className="text-faint">{(e.atMs / 1000).toFixed(2).padStart(6, " ")}s</span> {e.t}
                </li>
              ))}
          </ol>
        </div>
        <div className="grid min-w-0 gap-4">
          {view.preview && (
            <div>
              <Eyebrow className="mb-2">Recipe source</Eyebrow>
              <pre className="max-h-64 overflow-auto rounded-lg bg-ink p-3 font-mono text-[12px] text-paper/80">{JSON.stringify(view.preview.recipe, null, 2)}</pre>
            </div>
          )}
          {view.review?.typescript && (
            <div>
              <Eyebrow className="mb-2">TypeScript emitted from forge-ir (differentially tested)</Eyebrow>
              <pre className="max-h-64 overflow-auto rounded-lg bg-ink p-3 font-mono text-[12px] text-paper/70">{view.review.typescript}</pre>
            </div>
          )}
          <div>
            <Eyebrow className="mb-2">Checks</Eyebrow>
            <ul className="max-h-48 space-y-1 overflow-auto text-[12px]">
              {view.checks
                .filter((c) => !c.id || c.id === view.review?.candidate || c.id === view.preview?.candidate)
                .map((c, i) => (
                  <li key={i} className={c.passed ? "text-steel-hi" : "text-[#f1a99b]"}>
                    {c.passed ? "✓" : "✕"} [{c.kind}] {c.name}
                    {c.detail ? <span className="text-faint"> · {c.detail}</span> : null}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      </div>
    </details>
  );
}
