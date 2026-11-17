"use client";
import { useEffect, useState } from "react";
import { Button, Eyebrow, Panel, ProvenanceBadge, cx } from "./primitives";

type Layer = { id: string; label: string; where: string };
type Attack = { id: string; title: string; story: string; payload: string };
type Result = { blocked: boolean; layer: string; log: string[]; ms: number };

/** The path a proposal takes, top to bottom. The layer that stopped an attack lights up. */
function Diagram({ layers, hit, shatter }: { layers: Layer[]; hit?: string; shatter: boolean }) {
  return (
    <ol className="grid gap-1.5" aria-label="FORGE's layers of defense">
      {layers.map((l) => {
        const on = l.id === hit;
        return (
          <li
            key={l.id}
            className={cx(
              "relative flex items-center justify-between overflow-hidden rounded-lg border px-3 py-2 text-[13px] transition-all duration-500",
              on ? "border-amber bg-molten/15 text-paper shadow-[0_0_30px_-12px_rgb(255_106_31/0.9)]" : "border-line text-dim",
            )}
          >
            <span className="font-medium">{l.label}</span>
            <span className="font-mono text-[11px] text-faint">{l.where}</span>
            {on && shatter && (
              <span aria-hidden className="pointer-events-none absolute inset-0">
                {Array.from({ length: 9 }, (_, i) => (
                  <span
                    key={i}
                    className="absolute top-1/2 size-1.5 rounded-sm bg-amber"
                    style={{ left: `${8 + i * 10}%`, animation: `shard 700ms ${i * 25}ms cubic-bezier(.2,.8,.2,1) forwards`, ["--dx" as string]: `${(i % 3) - 1}rem`, ["--dy" as string]: `${i % 2 ? -1.6 : 1.4}rem` }}
                  />
                ))}
              </span>
            )}
            {on && <span className="sr-only"> stopped this attack</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function SafetyLab({ showcase }: { showcase: boolean }) {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [recorded, setRecorded] = useState<{ recordedAt: string; commit: string; results: (Attack & Result)[] }>();
  const [results, setResults] = useState<Record<string, Result>>({});
  const [active, setActive] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [shatter, setShatter] = useState(false);
  useEffect(() => {
    if (showcase) {
      fetch("/safety.json")
        .then((r) => r.json())
        .then((d) => {
          setLayers(d.layers);
          setAttacks(d.results);
          setRecorded(d);
          setActive(d.results[0]?.id);
        })
        .catch(() => undefined);
      return;
    }
    fetch("/api/safety")
      .then((r) => r.json())
      .then((d) => {
        setLayers(d.layers);
        setAttacks(d.attacks);
        setActive(d.attacks[0]?.id);
      })
      .catch(() => undefined);
  }, [showcase]);
  const run = async (id: string) => {
    setActive(id);
    setShatter(false);
    if (recorded) {
      const r = recorded.results.find((x) => x.id === id)!;
      setResults((x) => ({ ...x, [id]: r }));
      setShatter(true);
      return;
    }
    setBusy(id);
    try {
      const res = await fetch("/api/safety", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const r = (await res.json()) as Result;
      setResults((x) => ({ ...x, [id]: r }));
      setShatter(true);
    } finally {
      setBusy(undefined);
    }
  };
  const runAll = async () => {
    for (const a of attacks) await run(a.id);
  };
  const a = attacks.find((x) => x.id === active);
  const r = active ? results[active] : undefined;
  const done = Object.values(results);
  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-10 sm:px-6">
      <style>{`@keyframes shard{to{transform:translate(var(--dx),var(--dy)) rotate(80deg);opacity:0}}`}</style>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold">Safety Lab</h1>
          <p className="mt-2 max-w-2xl text-dim">
            Eleven attacks, each run for real against a scratch FORGE with its own store, broker and sandbox. Your workspace is never touched. Every one is also an automated test.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {recorded && <ProvenanceBadge provenance="recorded" recordedAt={recorded.recordedAt} model={`commit ${recorded.commit}`} />}
          <Button tone="molten" onClick={runAll} disabled={!!busy}>
            {recorded ? "Replay all eleven" : "Fire all eleven"}
          </Button>
        </div>
      </div>
      {done.length > 0 && (
        <p className="font-display text-2xl" aria-live="polite">
          <span className="text-steel-hi">{done.filter((x) => x.blocked).length}</span> of {done.length} stopped
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,0.9fr)_1.3fr_minmax(260px,0.8fr)]">
        <ul className="grid content-start gap-2">
          {attacks.map((x, i) => {
            const res = results[x.id];
            return (
              <li key={x.id}>
                <button
                  onClick={() => run(x.id)}
                  className={cx("flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-[14px] transition-colors", active === x.id ? "border-line-strong bg-iron" : "border-line hover:bg-iron/60")}
                >
                  <span className="num w-5 shrink-0 text-faint">{i + 1}</span>
                  <span className="flex-1">{x.title}</span>
                  <span className={cx("text-[11px] font-semibold uppercase tracking-[0.12em]", busy === x.id ? "text-amber" : res ? (res.blocked ? "text-steel-hi" : "text-[#f1a99b]") : "text-faint")}>
                    {busy === x.id ? "firing" : res ? (res.blocked ? "stopped" : "got through") : "run"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {a && (
          <Panel tone={r ? (r.blocked ? "steel" : "slag") : undefined} className="grid content-start gap-4 p-5">
            <div>
              <Eyebrow>Attack</Eyebrow>
              <h2 className="mt-1 font-display text-2xl font-semibold">{a.title}</h2>
              <p className="mt-2 text-dim">{a.story}</p>
            </div>
            <div>
              <Eyebrow className="mb-1">Payload</Eyebrow>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-ink p-3 font-mono text-[12px] text-[#f1a99b]">{a.payload}</pre>
            </div>
            {r ? (
              <div>
                <Eyebrow className="mb-1">What happened ({r.ms.toFixed(0)} ms)</Eyebrow>
                <ol className="space-y-1 rounded-lg bg-ink p-3 font-mono text-[12px] text-paper/85">
                  {r.log.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ol>
                <p className={cx("mt-3 font-display text-xl", r.blocked ? "text-steel-hi" : "text-[#f1a99b]")}>
                  {r.blocked ? `Stopped at: ${layers.find((l) => l.id === r.layer)?.label}` : "Not stopped"}
                </p>
              </div>
            ) : (
              <Button onClick={() => run(a.id)} disabled={!!busy}>
                {recorded ? "Replay this attack" : "Fire this attack"}
              </Button>
            )}
          </Panel>
        )}
        <div>
          <Eyebrow className="mb-2">Layers</Eyebrow>
          <Diagram layers={layers} hit={r?.layer} shatter={shatter} />
        </div>
      </div>
    </div>
  );
}
