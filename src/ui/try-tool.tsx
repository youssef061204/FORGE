"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { formatFromName, sniffFormat, type Format } from "@/core/codec";
import { replay } from "@/core/events/reducer";
import type { Tape } from "@/core/events/types";
import { loadTape } from "./build-source";
import { runInBrowser, type BrowserRun } from "./browser-runner";
import { Button, Eyebrow, Panel, ProvenanceBadge } from "./primitives";
import { XRay } from "./xray";

/** Run a recorded build's winning recipe on a file of your own, entirely in this browser tab. */
export function TryTool({ name }: { name: string }) {
  const [tape, setTape] = useState<Tape>();
  const [file, setFile] = useState<{ name: string; text: string }>();
  const [run, setRun] = useState<BrowserRun>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    loadTape(name).then(
      (t) => {
        setTape(t);
        setFile({ name: t.files[0].name, text: t.files[0].text });
      },
      (e) => setError(e.message),
    );
  }, [name]);
  const view = tape ? replay(tape.events, tape.id) : undefined;
  const recipe = view?.preview && !view.preview.provisional ? view.preview.recipe : undefined;
  useEffect(() => {
    if (!recipe || !file || !tape) return;
    let alive = true;
    const format: Format = formatFromName(file.name) ?? sniffFormat(file.text);
    runInBrowser(recipe, [{ slot: recipe.inputs[0].slot, name: file.name, format, text: file.text }])
      .then((r) => {
        if (!alive) return;
        setRun(r);
        setError(undefined);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [recipe, file, tape]);
  if (error && !tape) return <p className="mx-auto max-w-[1320px] p-6 text-[#f1a99b]">{error}</p>;
  if (!tape || !view) return <div className="mx-auto mt-10 h-40 max-w-[1320px] animate-pulse rounded-2xl bg-iron" />;
  if (!recipe) return <p className="mx-auto max-w-[1320px] p-6 text-dim">This recording didn&apos;t produce a tool to try.</p>;
  const out = run?.outputs.find((o) => o.kind === "file") as Extract<BrowserRun["outputs"][number], { kind: "file" }> | undefined;
  const download = () => {
    if (!out) return;
    const url = URL.createObjectURL(new Blob([out.text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = out.name;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="mx-auto grid max-w-[1320px] gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <ProvenanceBadge provenance={tape.provenance} model={tape.model} recordedAt={tape.recordedAt} hardware={tape.hardware} />
        <Link href={`/forge/tape-${name}`} className="text-[13px] text-dim hover:text-paper">
          Watch how it was built
        </Link>
      </div>
      <div>
        <h1 className="font-display text-3xl font-semibold sm:text-4xl">{view.intent?.title ?? tape.request}</h1>
        <p className="mt-2 max-w-2xl text-dim">
          This tool runs right here, in your browser. Your file never leaves this tab: the page isn&apos;t allowed to send anything anywhere.
        </p>
      </div>
      <Panel className="flex flex-wrap items-center gap-3 p-4">
        <Eyebrow>Input</Eyebrow>
        <span className="font-mono text-[13px]">{file?.name}</span>
        <label className="cursor-pointer">
          <span className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-iron px-3 text-[14px] hover:bg-ash">Use my own file</span>
          <input
            type="file"
            hidden
            accept=".csv,.tsv,.json,.txt,.log"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 10 * 1024 * 1024) return setError("That file is over 10 MB.");
              setFile({ name: f.name, text: await f.text() });
            }}
          />
        </label>
        <Button tone="ghost" size="sm" onClick={() => setFile({ name: tape.files[0].name, text: tape.files[0].text })}>
          Back to the sample
        </Button>
        {out && (
          <Button tone="molten" size="sm" className="ml-auto" onClick={download}>
            Download {out.name}
          </Button>
        )}
      </Panel>
      {error && (
        <p role="alert" className="rounded-lg bg-slag-deep/60 px-3 py-2 text-[#f1a99b]">
          {error}. The tool expects columns like {Object.values(view.profiles)[0]?.columns.map((c) => c.name).join(", ")}.
        </p>
      )}
      {run && <XRay recipe={recipe} run={run} />}
    </div>
  );
}
