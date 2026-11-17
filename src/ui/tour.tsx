"use client";
/**
 * The seven-step tour, driven by a recording of a real build. Steps 1, 2 and 7
 * show the MCP side; steps 3-5 replay the recorded build; step 6 is your own
 * approval, and step 7 runs the approved recipe in this browser.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { mcpToolName, STATIC_MCP_TOOLS } from "@/core/contracts/tool-name";
import type { BuildEventType, Tape } from "@/core/events/types";
import { loadTape, useTape } from "./build-source";
import { runInBrowser } from "./browser-runner";
import { Lanes } from "./floor/lanes";
import { Passport } from "./floor/approve";
import { Preview } from "./floor/preview";
import { Understand } from "./floor/understand";
import { Button, Eyebrow, Panel, ProvenanceBadge, Term, cx } from "./primitives";

const STEPS: { title: string; say: string; until?: BuildEventType }[] = [
  { title: "The assistant is missing a tool", say: "Someone asks their AI assistant for sales totals from a spreadsheet. It looks through its tools and has nothing that can do it." },
  { title: "It asks FORGE, in plain words", say: "The assistant can't build tools, but it can ask FORGE for one. The request is ordinary language, plus the file." },
  { title: "FORGE reads the file", say: "Before any model runs, FORGE looks at the data itself: the columns, what kind of values they hold, a few real rows.", until: "profile.ready" },
  { title: "Several drafts, tested against each other", say: "A small local model writes several drafts at once. Each runs on the real file and on tricky variants. Drafts that disagree drop out.", until: "consensus.formed" },
  { title: "Here is exactly what it does", say: "The winner, as a recipe written from the program itself. Tap a number in the result and the rows that produced it light up.", until: "review.ready" },
  { title: "Nothing runs until you approve", say: "The permission card says exactly what the tool may touch, and what it can't. Press and hold to approve it." },
  { title: "The assistant can use it, until you say stop", say: "The tool appears in the assistant's list and answers. Revoke it, and the next call is refused." },
];

function ToolList({ extra, revoked }: { extra?: string; revoked?: boolean }) {
  return (
    <ul className="space-y-1.5 font-mono text-[12.5px]">
      {STATIC_MCP_TOOLS.map((t) => (
        <li key={t.name} className="text-dim">
          {t.name}
        </li>
      ))}
      {extra && <li className={cx("transition-colors duration-700", revoked ? "text-faint line-through" : "text-amber")}>{extra}</li>}
    </ul>
  );
}

function AssistantPanel({ step, toolName, answer, refused, revoked }: { step: number; toolName?: string; answer?: string; refused?: boolean; revoked?: boolean }) {
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <Eyebrow>An MCP assistant</Eyebrow>
        <span className="text-[11px] text-faint">illustration of the protocol exchange</span>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_200px]">
        <div className="space-y-3 text-[14px]">
          <p className="rounded-xl bg-iron px-3 py-2">What were total sales for each item in orders.csv?</p>
          {step === 0 && <p className="rounded-xl border border-slag/40 px-3 py-2 text-[#f1a99b]">I don&apos;t have a tool that can compute that from your file.</p>}
          {step >= 1 && step < 6 && (
            <pre className="overflow-x-auto rounded-xl border border-line bg-ink p-3 font-mono text-[12px] text-paper/85">{`tools/call forge_build
{ "request": "Total sales by item, as quantity
   times price. Save totals.json mapping
   each item to its total.",
  "files": ["orders.csv"] }`}</pre>
          )}
          {step >= 1 && step < 6 && <p className="text-[13px] text-dim">FORGE answers with a review link. Only a person can approve the result.</p>}
          {answer && !refused && <p className="rounded-xl border border-steel/40 px-3 py-2 text-steel-hi">{answer}</p>}
          {refused && <p className="rounded-xl border border-slag/50 bg-slag-deep/40 px-3 py-2 text-[#f1a99b]">Refused: {toolName} was revoked. Nothing ran.</p>}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">tools/list</div>
          <div className="mt-2">
            <ToolList extra={step >= 6 ? toolName : undefined} revoked={revoked} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function Tour() {
  const params = useSearchParams();
  const autoplay = params.get("autoplay") === "1";
  const [tape, setTape] = useState<Tape>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    loadTape("orders-1").then(setTape, (e) => setError(e.message));
  }, []);
  if (error) return <p className="mx-auto max-w-3xl p-6 text-[#f1a99b]">The tour recording is missing ({error}). Run npm run tapes:record.</p>;
  if (!tape) return <div className="mx-auto mt-16 h-60 max-w-5xl animate-pulse rounded-2xl bg-iron" />;
  return <TourPlayer key={tape.id} tape={tape} autoplay={autoplay} />;
}

function TourPlayer({ tape, autoplay }: { tape: Tape; autoplay: boolean }) {
  const player = useTape(tape, { autoplay: false });
  const [step, setStep] = useState(0);
  const [approved, setApproved] = useState(false);
  const [answer, setAnswer] = useState<string>();
  const [revoked, setRevoked] = useState(false);
  const [refused, setRefused] = useState(false);
  const view = player.view;
  const toolName = useMemo(() => mcpToolName(view.intent?.title ?? "total sales by item", tape.id), [view.intent?.title, tape.id]);
  const s = STEPS[step];

  // Each build step plays the recording up to its milestone, on the recording's own timeline.
  useEffect(() => {
    const until = STEPS[step].until;
    if (!until) return;
    const reached = player.events.some((e) => e.t === until);
    player.setPlaying(!reached);
  }, [step, player.events, player]);

  const next = () => setStep((n) => Math.min(STEPS.length, n + 1));
  const ready = !s?.until || player.events.some((e) => e.t === s.until);

  // Hands-free presenter mode.
  useEffect(() => {
    if (!autoplay || !s) return;
    if (step === 5 && !approved) {
      const t = setTimeout(() => setApproved(true), 4000);
      return () => clearTimeout(t);
    }
    if (!ready) return;
    const t = setTimeout(next, step === 4 ? 9000 : 6500);
    return () => clearTimeout(t);
  }, [autoplay, step, ready, approved, s]);

  // Step 7: run the approved recipe in this browser, then show a refused call after revoking.
  useEffect(() => {
    if (step !== 6 || !view.preview || answer) return;
    const recipe = view.preview.recipe;
    const f = tape.files[0];
    runInBrowser(recipe, [{ slot: recipe.inputs[0].slot, name: f.name, format: f.format as never, text: f.text }], false)
      .then((r) => {
        const out = r.outputs.find((o) => o.kind === "file");
        if (out && out.kind === "file") {
          const firstRows = out.table.rows.slice(0, 3).map((row) => Object.values(row).join(": ")).join(", ");
          setAnswer(`${toolName} returned ${out.name} with ${out.table.total} rows: ${firstRows}${out.table.total > 3 ? ", …" : ""}`);
        }
      })
      .catch((e) => setAnswer(`The tool could not run: ${e.message}`));
  }, [step, view.preview, answer, tape.files, toolName]);
  useEffect(() => {
    if (!autoplay || step !== 6 || !answer || revoked) return;
    const t = setTimeout(() => (setRevoked(true), setTimeout(() => setRefused(true), 1200)), 4000);
    return () => clearTimeout(t);
  }, [autoplay, step, answer, revoked]);

  if (step >= STEPS.length) return <TourEnd />;
  const agreement = view.consensus?.agreement;
  return (
    <div className="mx-auto grid max-w-[1180px] gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="num text-[13px] text-faint">
          {step + 1} / {STEPS.length}
        </span>
        <div className="flex gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className={cx("h-1 w-6 rounded-full transition-colors duration-500", i < step ? "bg-steel" : i === step ? "bg-molten" : "bg-ash")} />
          ))}
        </div>
        <ProvenanceBadge provenance={tape.provenance} model={tape.model} recordedAt={tape.recordedAt} hardware={tape.hardware} />
        {autoplay && <span className="text-[12px] text-faint">presenter mode</span>}
      </div>
      <div aria-live="polite">
        <h1 className="font-display text-[30px] font-semibold leading-tight sm:text-[42px]">{s.title}</h1>
        <p className="mt-3 max-w-3xl text-[18px] leading-relaxed text-dim">
          {s.say}
          {step === 3 && agreement ? <span className="text-steel-hi"> In this recording: {agreement}.</span> : null}
        </p>
      </div>

      <div className="min-h-[360px]">
        {(step === 0 || step === 1) && <AssistantPanel step={step} />}
        {step === 2 && <Understand view={{ ...view, intent: undefined }} explain={false} />}
        {step === 3 && <Lanes view={view} explain={false} />}
        {step === 4 && view.preview && <Preview view={view} explain={false} readOnly />}
        {step === 5 && view.review && (
          <div className="grid gap-3">
            {approved ? (
              <Panel tone="steel" className="p-6">
                <Eyebrow>Approved</Eyebrow>
                <p className="mt-1 font-display text-2xl text-steel-hi cooling">Sealed to program {view.review.hash.slice(0, 12)}…</p>
                <p className="mt-2 text-dim">In this tour the approval lives in your browser. On your own FORGE it is recorded with a receipt, and any change to the program needs a new one.</p>
              </Panel>
            ) : (
              <Passport view={view} explain={false} onApprove={() => setApproved(true)} />
            )}
          </div>
        )}
        {step === 6 && (
          <div className="grid gap-4">
            <AssistantPanel step={6} toolName={toolName} answer={answer} refused={refused} revoked={revoked} />
            <div className="flex flex-wrap items-center gap-3">
              {!revoked ? (
                <Button tone="slag" disabled={!answer} onClick={() => (setRevoked(true), setTimeout(() => setRefused(true), 900))}>
                  Revoke {toolName}
                </Button>
              ) : (
                <span className="text-[14px] text-[#f1a99b]">Revoked. The tool left the list, and the next call was refused.</span>
              )}
              <span className="text-[13px] text-faint">The tool ran here, in your browser, with the same engine FORGE uses.</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <Button tone="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
          Back
        </Button>
        {!ready && <span className="text-[13px] text-amber ember">Playing the recording…</span>}
        {ready && step >= 2 && step <= 4 && (
          <Button tone="ghost" size="sm" onClick={() => player.seek(STEPS[step].until)}>
            Replay
          </Button>
        )}
        <Button tone="molten" className="ml-auto" onClick={next} disabled={!ready || (step === 5 && !approved)}>
          {step === 5 && !approved ? "Approve to continue" : step === STEPS.length - 1 ? "Finish" : "Next"}
        </Button>
      </div>
      <p className="text-[12px] text-faint">
        Recorded from a real build: {tape.model} on {tape.hardware ?? "this machine"}, {tape.recordedAt ? new Date(tape.recordedAt).toLocaleDateString() : ""}. Replayed on its original timeline. <Term term="MCP">What is MCP?</Term>
      </p>
    </div>
  );
}

function TourEnd() {
  return (
    <div className="mx-auto grid max-w-[1000px] gap-8 px-4 py-16 sm:px-6">
      <h1 className="font-display text-[34px] font-semibold leading-tight sm:text-[48px]">Now try it with your own file, or pick a sample.</h1>
      <div className="flex flex-wrap gap-3">
        <Link href="/#build">
          <Button tone="molten" size="lg">
            Pick a sample
          </Button>
        </Link>
        <Link href="/try/contacts-1">
          <Button size="lg">Run a tool on my own file</Button>
        </Link>
        <Link href="/tour">
          <Button size="lg" tone="ghost">
            Watch again
          </Button>
        </Link>
      </div>
      <p className="max-w-2xl text-dim">Every tool runs in your browser here, and your file never leaves it. On your own computer, FORGE builds anything you can describe, with a free local model.</p>
    </div>
  );
}
