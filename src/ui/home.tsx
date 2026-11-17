"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { sniffFormat } from "@/core/codec";
import { SAMPLES, type Sample } from "@/showcase/samples";
import { HeroLoop } from "./hero-loop";
import { Button, Eyebrow, Panel, Term, cx } from "./primitives";

type TapeIndex = { name: string; sample: string; level: number; request: string; provenance: string; model?: string }[];
type ToolSummary = { id: string; name: string; description: string; status: string; currentVersion?: number; lastRun?: { summary: string; at: string } };
type Attached = { name: string; text: string; sample?: string };

export function Home({ showcase }: { showcase: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [request, setRequest] = useState(params.get("request") ?? "");
  const [files, setFiles] = useState<Attached[]>([]);
  const [sample, setSample] = useState<Sample>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [tapes, setTapes] = useState<TapeIndex>([]);
  const [tools, setTools] = useState<ToolSummary[]>([]);
  const [live, setLive] = useState<boolean | undefined>(showcase ? false : undefined);
  const [drag, setDrag] = useState(false);
  const composer = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/tapes/index.json")
      .then((r) => (r.ok ? r.json() : []))
      .then(setTapes)
      .catch(() => undefined);
    if (showcase) return;
    fetch("/api/tools")
      .then((r) => r.json())
      .then((d) => setTools(d.tools ?? []))
      .catch(() => undefined);
    fetch("/api/status")
      .then((r) => r.json())
      .then((s) => setLive(s.model?.state === "live" || s.model?.state === "scripted"))
      .catch(() => setLive(false));
  }, [showcase]);

  const chooseSample = (s: Sample) => {
    setSample(s);
    setFiles([{ name: s.file.name, text: s.file.text, sample: s.id }]);
    composer.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const addFiles = async (list: FileList | File[]) => {
    const read = await Promise.all(
      [...list].slice(0, 4).map(async (f) => {
        if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is over the 10 MB limit.`);
        return { name: f.name, text: await f.text() };
      }),
    );
    setSample(undefined);
    setFiles((prev) => [...prev.filter((p) => !p.sample), ...read]);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text");
    if (text.includes("\n") && (text.includes("\t") || text.includes(",")) && text.split("\n").length > 2 && !request) {
      e.preventDefault();
      const fmt = sniffFormat(text);
      setFiles((prev) => [...prev, { name: `pasted.${fmt === "tsv" ? "tsv" : fmt === "json" ? "json" : "csv"}`, text }]);
    }
  };
  const tapeFor = (req: string) => tapes.find((t) => t.request === req);

  const forge = async () => {
    setError(undefined);
    const tape = tapeFor(request.trim());
    if (!live) {
      if (tape) router.push(`/forge/tape-${tape.name}`);
      else setError(showcase ? "The showcase can replay the suggested requests. Run FORGE locally to build anything you like." : "No local model is running, so only recorded builds can play. Pick a suggested request, or start Ollama.");
      return;
    }
    if (!files.length) {
      setError("Attach a file first: drop one here, paste a table, or pick a sample below.");
      return;
    }
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const f of files) {
        const res = await fetch("/api/files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: f.name, text: f.text }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        ids.push(d.file.id);
      }
      const res = await fetch("/api/builds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: request.trim(), fileIds: ids }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      router.push(`/forge/${d.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div>
      <section className="relative overflow-hidden border-b border-line">
        <div className="mx-auto grid max-w-[1320px] items-center gap-10 px-4 py-14 sm:px-6 md:py-20 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <h1 className="font-display text-[40px] font-semibold leading-[1.03] tracking-tight sm:text-[60px]">
              AI assistants can only use the tools they&apos;ve been given.
            </h1>
            <p className="mt-6 max-w-xl text-[19px] leading-relaxed text-dim sm:text-[21px]">
              <span className="molten-text font-semibold">FORGE builds the missing tool while you watch</span>, and nothing runs until you approve it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/tour">
                <Button tone="molten" size="lg">
                  Watch a tool get built
                </Button>
              </Link>
              <Button size="lg" onClick={() => composer.current?.scrollIntoView({ behavior: "smooth" })}>
                Build one yourself
              </Button>
            </div>
            <p className="mt-6 text-[14px] text-faint">
              Runs on your computer with a free local model. Tools are <Term term="recipe">recipes</Term>, not code from the model, and any <Term term="MCP">MCP</Term> assistant can call them.
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroLoop />
          </div>
        </div>
      </section>

      <section ref={composer} id="build" className="mx-auto max-w-[1320px] scroll-mt-20 px-4 py-12 sm:px-6">
        <Eyebrow>Build a tool</Eyebrow>
        <div
          className={cx("mt-3 rounded-2xl border bg-coal/80 p-4 transition-colors sm:p-5", drag ? "border-amber" : "border-line-strong")}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void addFiles(e.dataTransfer.files).catch((err) => setError(err.message));
          }}
        >
          <label htmlFor="request" className="sr-only">
            What should the tool do?
          </label>
          <textarea
            id="request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void forge()}
            rows={3}
            placeholder="Describe the result you want, e.g. “Total sales by item and save totals.json”"
            className="w-full resize-none bg-transparent font-display text-[20px] leading-snug text-paper placeholder:text-faint focus:outline-none sm:text-[22px]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {files.map((f) => (
              <span key={f.name} className="flex items-center gap-2 rounded-lg border border-line bg-iron px-2.5 py-1 font-mono text-[12px] text-paper">
                {f.name}
                <button aria-label={`Remove ${f.name}`} className="text-faint hover:text-paper" onClick={() => setFiles(files.filter((x) => x !== f))}>
                  ✕
                </button>
              </span>
            ))}
            <button className="rounded-lg border border-dashed border-line-strong px-3 py-1 text-[13px] text-dim hover:text-paper" onClick={() => fileInput.current?.click()}>
              + Add a file
            </button>
            <input ref={fileInput} type="file" multiple hidden accept=".csv,.tsv,.json,.jsonl,.txt,.log,.md" onChange={(e) => e.target.files && void addFiles(e.target.files).catch((err) => setError(err.message))} />
            <span className="hidden text-[12px] text-faint sm:inline">or drop it here, or paste a table</span>
            <Button tone="molten" className="ml-auto" disabled={busy || request.trim().length < 3} onClick={forge}>
              {busy ? "Starting…" : live === false && tapeFor(request.trim()) ? "Play the recording" : "Forge it"}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-[14px] text-[#f1a99b]">
              {error}
            </p>
          )}
        </div>
        {sample && (
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Suggested requests">
            {sample.requests.map((r) => (
              <button key={r.text} onClick={() => setRequest(r.text)} className={cx("rounded-xl border px-3 py-2 text-left text-[14px] transition-colors", request === r.text ? "border-amber bg-molten/10 text-paper" : "border-line text-dim hover:border-line-strong hover:text-paper")}>
                <span className="mr-2 text-[11px] font-semibold text-faint">{"●".repeat(r.level)}</span>
                {r.text}
                {tapeFor(r.text) && <span className="ml-2 text-[11px] text-steel">recorded</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-[1320px] px-4 pb-16 sm:px-6">
        <Eyebrow>Or start from a sample</Eyebrow>
        <p className="mt-1 text-[15px] text-dim">Synthetic data. Nobody needs their own file to see a result.</p>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SAMPLES.map((s) => (
            <li key={s.id}>
              <button onClick={() => chooseSample(s)} className={cx("h-full w-full rounded-2xl border bg-coal/60 p-4 text-left transition-colors hover:border-line-strong", sample?.id === s.id ? "border-amber" : "border-line")}>
                <div className="font-display text-[17px] font-semibold">{s.title}</div>
                <div className="mt-1 text-[13px] text-dim">{s.blurb}</div>
                <div className="mt-3 font-mono text-[11px] text-faint">{s.file.name}</div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {tools.length > 0 && (
        <section className="mx-auto max-w-[1320px] px-4 pb-20 sm:px-6">
          <div className="flex items-baseline justify-between">
            <Eyebrow>Your tools</Eyebrow>
            <Link href="/tools" className="text-[13px] text-dim hover:text-paper">
              Toolbox →
            </Link>
          </div>
          <ul className="mt-4 grid gap-3 md:grid-cols-3">
            {tools.slice(0, 6).map((t) => (
              <li key={t.id}>
                <Link href={`/tools/${t.id}`}>
                  <Panel tone={t.status === "active" ? "steel" : undefined} className="h-full p-4 transition-colors hover:bg-iron">
                    <div className="flex items-center justify-between">
                      <span className="font-display text-[17px] font-semibold">{t.name}</span>
                      <span className={cx("text-[11px] uppercase tracking-[0.14em]", t.status === "active" ? "text-steel-hi" : "text-[#f1a99b]")}>{t.status}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] text-dim">{t.description}</p>
                    {t.lastRun && <p className="mt-2 text-[12px] text-faint">{t.lastRun.summary}</p>}
                  </Panel>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
