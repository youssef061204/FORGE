"use client";
import { useEffect, useState } from "react";
import { formatBytes } from "@/core/contracts/passport";
import { Button, Eyebrow, Panel, cx } from "./primitives";

type Settings = {
  model: { state: "live"; model: string; url: string; models: { name: string; size: number; parameterSize?: string }[] } | { state: "scripted" } | { state: "offline"; reason: string };
  memory: boolean;
  learned: number;
  home: string;
  limits: { maxInputBytes: number; maxRows: number; maxMs: number };
  customCode: string;
};

export function SettingsPage({ showcase }: { showcase: boolean }) {
  const [s, setS] = useState<Settings>();
  const load = () =>
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setS)
      .catch(() => undefined);
  useEffect(() => {
    if (!showcase) void load();
  }, [showcase]);
  const save = async (patch: Record<string, unknown>) => {
    await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    await load();
  };
  const howTo = (
    <Panel className="p-5">
      <Eyebrow>Turn on live generation</Eyebrow>
      <ol className="mt-3 space-y-2 text-[14px] text-dim">
        <li>
          1. Install <span className="text-paper">Ollama</span> and download a model once yourself, for example <code className="font-mono text-paper">ollama pull qwen2.5:7b-instruct</code>. FORGE never downloads models.
        </li>
        <li>
          2. Start it on this computer only, with cloud features off:
          <pre className="mt-2 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[12px] text-paper/85">{`# PowerShell
$env:OLLAMA_HOST = "127.0.0.1:11435"; $env:OLLAMA_NO_CLOUD = "1"; ollama serve
# macOS / Linux
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_NO_CLOUD=1 ollama serve`}</pre>
        </li>
        <li>
          3. Run <code className="font-mono text-paper">npm run forge</code>. It finds Ollama on port 11434 or 11435 by itself.
        </li>
      </ol>
    </Panel>
  );
  if (showcase)
    return (
      <div className="mx-auto grid max-w-[1000px] gap-6 px-4 py-10 sm:px-6">
        <h1 className="font-display text-4xl font-semibold">Run FORGE on your computer</h1>
        <p className="text-dim">The showcase replays recorded builds. On your own computer FORGE builds anything you describe, with a free local model, and connects to your assistants.</p>
        <Panel className="p-5">
          <Eyebrow>Quickstart</Eyebrow>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[12.5px] text-paper/85">{`git clone https://github.com/youssef061204/FORGE
cd FORGE && npm install
npm run forge`}</pre>
        </Panel>
        {howTo}
      </div>
    );
  return (
    <div className="mx-auto grid max-w-[1000px] gap-6 px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl font-semibold">Settings</h1>
      <Panel tone={s?.model.state === "live" ? "hot" : undefined} className="p-5">
        <Eyebrow>Model</Eyebrow>
        {!s ? (
          <div className="mt-3 h-10 animate-pulse rounded bg-iron" />
        ) : s.model.state === "live" ? (
          <>
            <p className="mt-2 text-[15px]">
              Using <span className="font-semibold text-amber">{s.model.model}</span> at <span className="font-mono text-[13px]">{s.model.url}</span>
            </p>
            <ul className="mt-4 grid gap-2">
              {s.model.models.map((m) => (
                <li key={m.name}>
                  <button
                    onClick={() => save({ model: m.name })}
                    className={cx("flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[14px]", m.name === (s.model as { model: string }).model ? "border-amber bg-molten/10" : "border-line hover:bg-iron")}
                  >
                    <span className="font-mono">{m.name}</span>
                    <span className="num text-[12px] text-faint">
                      {m.parameterSize ?? ""} · {formatBytes(m.size)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13px] text-faint">Benchmarks were run with qwen2.5:7b-instruct. Other models work; their quality is measured only if you run the benchmark with them.</p>
          </>
        ) : (
          <p className="mt-2 text-dim">{s.model.state === "offline" ? s.model.reason : "Scripted stand-in (tests)."}</p>
        )}
      </Panel>
      {s?.model.state !== "live" && howTo}
      <Panel className="p-5">
        <Eyebrow>Learned memory</Eyebrow>
        <p className="mt-2 text-[14px] text-dim">
          Every tool you approve can become an example for future builds, so FORGE improves with use. It stays on this computer. {s ? `${s.learned} remembered.` : ""}
        </p>
        <Button className="mt-3" size="sm" onClick={() => save({ memory: !s?.memory })}>
          {s?.memory ? "Turn off" : "Turn on"}
        </Button>
      </Panel>
      <Panel className="p-5">
        <Eyebrow>Where your data lives</Eyebrow>
        <p className="mt-2 font-mono text-[13px] text-paper">{s?.home}</p>
        <p className="mt-2 text-[14px] text-dim">One SQLite file with your files, tools, runs and receipts. Nothing is synced anywhere.</p>
        {s && (
          <p className="num mt-3 text-[13px] text-faint">
            Limits per run: {formatBytes(s.limits.maxInputBytes)} in · {s.limits.maxRows.toLocaleString()} rows · {s.limits.maxMs / 1000} s · custom code {s.customCode}
          </p>
        )}
      </Panel>
    </div>
  );
}
