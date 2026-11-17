import Link from "next/link";
import { latest, legacyBaseline, runs, type RunFile } from "@/server/results";
import { Eyebrow, Panel } from "@/ui/primitives";

export const metadata = { title: "Scorecard" };

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const secs = (ms: number | null | undefined) => (ms === null || ms === undefined ? "—" : `${(ms / 1000).toFixed(1)} s`);

function Bar({ value, tone = "steel" }: { value: number; tone?: "steel" | "molten" | "slag" }) {
  return (
    <span className="relative block h-2 w-full overflow-hidden rounded-full bg-ash" aria-hidden>
      <span className={`absolute inset-y-0 left-0 rounded-full ${tone === "molten" ? "bg-gradient-to-r from-molten to-amber" : tone === "slag" ? "bg-slag" : "bg-steel"}`} style={{ width: `${value * 100}%` }} />
    </span>
  );
}

function Headline({ run, label, note }: { run?: RunFile; label: string; note: string }) {
  if (!run)
    return (
      <Panel className="p-6">
        <Eyebrow>{label}</Eyebrow>
        <p className="mt-2 text-dim">No committed result yet.</p>
      </Panel>
    );
  const s = run.summary;
  return (
    <Panel tone="steel" className="p-6">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="font-display text-6xl font-semibold text-steel-hi">{pct(s.passRate)}</span>
        <span className="num text-dim">
          {s.passed} of {s.n}
        </span>
      </div>
      <p className="num mt-1 text-[13px] text-faint">
        95% interval {pct(s.interval95[0])}–{pct(s.interval95[1])} · Wilson
      </p>
      <p className="mt-3 text-[14px] text-dim">{note}</p>
      <dl className="num mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
        <dt className="text-faint">time to preview p50</dt>
        <dd>{secs(s.timeToPreviewP50Ms)}</dd>
        <dt className="text-faint">time to preview p95</dt>
        <dd>{secs(s.timeToPreviewP95Ms)}</dd>
        <dt className="text-faint">verified but wrong</dt>
        <dd className={s.verifiedFalseSuccess ? "text-[#f1a99b]" : ""}>{s.verifiedFalseSuccess}</dd>
        {s.decisions && (
          <>
            <dt className="text-faint">connect / clarify / unsupported</dt>
            <dd>
              {s.decisions.correct} of {s.decisions.n}
            </dd>
          </>
        )}
        {s.firstPreviewCorrect !== undefined && (
          <>
            <dt className="text-faint">asked “which did you mean?”</dt>
            <dd>{s.clarified}</dd>
          </>
        )}
      </dl>
      <p className="mt-4 text-[12px] text-faint">
        {s.model} · {s.hardware} · commit {s.commit} · {new Date(s.date).toLocaleDateString()} · {s.drafts} drafts
      </p>
      <p className="mt-1 font-mono text-[11px] text-faint">{s.command}</p>
    </Panel>
  );
}

function Breakdown({ title, data }: { title: string; data?: Record<string, { n: number; passed: number }> }) {
  if (!data) return null;
  return (
    <Panel className="p-5">
      <Eyebrow>{title}</Eyebrow>
      <ul className="mt-3 grid gap-2">
        {Object.entries(data).map(([k, v]) => (
          <li key={k} className="grid grid-cols-[minmax(110px,1fr)_2fr_auto] items-center gap-3 text-[13px]">
            <span className="truncate text-dim">{k}</span>
            <Bar value={v.passed / v.n} tone={v.passed === v.n ? "steel" : v.passed === 0 ? "slag" : "molten"} />
            <span className="num w-12 text-right">
              {v.passed}/{v.n}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function Scorecard() {
  const dev = latest("dev");
  const val = latest("validation");
  const holdout = latest("holdout");
  const legacy = legacyBaseline();
  const all = runs().filter((r) => !r.summary.dirty);
  const failures = val ? val.results.filter((r) => r.status !== "passed") : [];
  const categories = val?.summary.byCategory;
  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-10 sm:px-6">
      <div>
        <h1 className="font-display text-4xl font-semibold">Scorecard</h1>
        <p className="mt-2 max-w-3xl text-dim">
          Every number here is read from a committed result file under evaluation/results and comes with the command that reproduces it. The validation set was frozen by hash before its first run and is never used for prompts, examples or tuning.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Headline run={val} label="Validation set (held out)" note="71 missions written for FORGE 2: every operation family, three phrasing styles, distractor files, and connect, clarify and unsupported decisions." />
        <Headline run={dev} label="Development set" note="The 18 frozen missions from earlier work. FORGE 2 was iterated against these, so read this number as the ceiling, not the estimate." />
        <Panel className="p-6">
          <Eyebrow>Before FORGE 2</Eyebrow>
          {legacy && (
            <>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-display text-6xl font-semibold text-dim">
                  {legacy.summary.passed}/{legacy.summary.recorded}
                </span>
              </div>
              <p className="mt-2 text-[14px] text-dim">
                The previous IR pipeline, rerun unmodified on the development set with the same model and GPU (commit {legacy.commit}). Median {secs(legacy.summary.p50Ms)} per mission.
              </p>
              <p className="mt-2 text-[13px] text-faint">Previously published: {legacy.previouslyPublished}.</p>
            </>
          )}
          <div className="mt-5 border-t border-line pt-4">
            <Eyebrow>Sealed holdout</Eyebrow>
            {holdout ? (
              <>
                <p className="mt-2 font-display text-3xl font-semibold text-steel-hi">
                  {holdout.summary.passed} of {holdout.summary.n}
                </p>
                <p className="num mt-1 text-[13px] text-faint">
                  95% interval {pct(holdout.summary.interval95[0])}–{pct(holdout.summary.interval95[1])} · one run at commit {holdout.summary.commit}
                </p>
                <p className="mt-2 text-[13px] text-dim">
                  Written for the earlier runtime. 42 of its missions need connectors, notifications, schedules or reuse of installed tools, which FORGE 2 doesn&apos;t have yet, and they count as failures. See docs/EVALUATION.md.
                </p>
              </>
            ) : (
              <p className="mt-2 text-[14px] text-dim">Still sealed. It is opened once, at the final source freeze, and its result is reported whatever it is.</p>
            )}
          </div>
        </Panel>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Breakdown title="Validation by phrasing" data={val?.summary.byPhrasing} />
        <Breakdown title="Validation by category" data={categories} />
      </div>
      {val && (
        <Panel className="p-5">
          <Eyebrow>Latency on the validation set (each mission)</Eyebrow>
          <div className="mt-4 flex h-28 items-end gap-[3px]">
            {[...val.results]
              .sort((a, b) => a.ms - b.ms)
              .map((r) => (
                <span key={r.id} title={`${r.id}: ${(r.ms / 1000).toFixed(1)} s`} className={`flex-1 rounded-t-sm ${r.status === "passed" ? "bg-steel/70" : "bg-slag/80"}`} style={{ height: `${Math.min(100, (r.ms / 40000) * 100)}%` }} />
              ))}
          </div>
          <p className="mt-2 text-[12px] text-faint">Sorted by total time; red bars are failures. Scale tops out at 40 s.</p>
        </Panel>
      )}
      {failures.length > 0 && val && (
        <Panel className="p-5">
          <Eyebrow>Every validation failure</Eyebrow>
          <ul className="mt-3 divide-y divide-line">
            {failures.map((f) => (
              <li key={f.id} className="grid gap-1 py-3 sm:grid-cols-[220px_1fr_auto] sm:items-center sm:gap-4">
                <span className="font-mono text-[13px]">{f.id}</span>
                <span className="text-[13px] text-dim">{(f.why ?? "").slice(0, 220)}</span>
                {val.tapes.includes(f.id) ? (
                  <Link href={`/scorecard/tape/${val.dir}/${f.id}`} className="text-[13px] text-amber hover:underline">
                    Replay →
                  </Link>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel className="p-5">
        <Eyebrow>Model arena (development set, latest run per model)</Eyebrow>
        <table className="mt-3 w-full text-left text-[13px]">
          <thead>
            <tr className="text-faint">
              <th className="py-1 font-medium">model</th>
              <th className="py-1 font-medium">passed</th>
              <th className="py-1 font-medium">time to preview p50</th>
              <th className="py-1 font-medium">commit</th>
            </tr>
          </thead>
          <tbody>
            {[...new Map(all.filter((r) => r.summary.corpus === "dev").map((r) => [r.summary.model, r])).values()].map((r) => (
              <tr key={r.summary.model} className="border-t border-line">
                <td className="py-1.5 font-mono">{r.summary.model}</td>
                <td className="num py-1.5">
                  {r.summary.passed}/{r.summary.n}
                </td>
                <td className="num py-1.5">{secs(r.summary.timeToPreviewP50Ms)}</td>
                <td className="num py-1.5 text-faint">{r.summary.commit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[12px] text-faint">Add a row: npx tsx evaluation/runner.ts --corpus=dev --model=&lt;installed model&gt;</p>
      </Panel>
      <Panel className="p-5">
        <Eyebrow>All committed runs</Eyebrow>
        <ul className="mt-3 space-y-1 font-mono text-[12.5px] text-dim">
          {all.map((r) => (
            <li key={r.dir + r.summary.corpus}>
              {r.dir} · {r.summary.corpus} · {r.summary.passed}/{r.summary.n} · {r.summary.model}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
