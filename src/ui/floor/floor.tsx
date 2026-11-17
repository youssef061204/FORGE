"use client";
/** The Forge Floor: one build, rendered from its event stream, stage by stage. */
import { useState } from "react";
import type { BuildView } from "@/core/events/reducer";
import { STAGES } from "@/core/events/reducer";
import type { BuildEvent, Example } from "@/core/events/types";
import { Eyebrow, ProvenanceBadge, StageLine, cx } from "../primitives";
import { Failure, Hood, Installed, Passport } from "./approve";
import { Lanes } from "./lanes";
import { Ambiguity, Preview } from "./preview";
import { RouteCard, Understand } from "./understand";

export type FloorActions = {
  answer?: (cluster: string) => void;
  approve?: () => void;
  fix?: (example: Example) => void;
  retry?: (drafts: number) => void;
  simplify?: () => void;
};

const STAGE_NOTE: Record<string, string> = {
  understand: "Reading the file and the request",
  draft: "Writing drafts",
  test: "Testing every draft",
  choose: "Comparing behavior",
  preview: "Here is what it does",
  approve: "Waiting for your approval",
  installed: "Installed",
};

export function ForgeFloor({ view, events, actions = {}, readOnly, explain = true, showcase }: { view: BuildView; events: BuildEvent[]; actions?: FloorActions; readOnly?: boolean; explain?: boolean; showcase?: boolean }) {
  const followed = STAGES.indexOf(view.stage);
  const [pin, setPin] = useState<{ stage: number; at: number } | null>(null);
  // A pin holds only until the build reaches a new stage; then the floor follows it again.
  const pinned = pin && pin.at === view.reached ? pin.stage : null;
  const setPinned = (stage: number | null) => setPin(stage === null ? null : { stage, at: view.reached });
  const current = pinned ?? followed;
  const stage = STAGES[current];
  const ended = !!view.outcome;
  const routed = view.route && ["CONNECT", "CLARIFY", "UNSUPPORTED", "REUSE"].includes(view.route.route);
  return (
    <div className="mx-auto grid max-w-[1320px] gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <ProvenanceBadge provenance={view.provenance} model={view.model} recordedAt={view.recordedAt} hardware={view.hardware} />
          <span className="num text-[13px] text-faint">{(view.elapsedMs / 1000).toFixed(1)} s</span>
          {view.stats && <span className="num hidden text-[13px] text-faint sm:inline">{view.stats.calls} model calls</span>}
          {!ended && (
            <span role="status" aria-live="polite" className="text-[13px] text-amber">
              {view.ambiguity && !view.ambiguity.resolved ? "Waiting for your answer" : STAGE_NOTE[view.stage]}
            </span>
          )}
        </div>
        <h1 className="max-w-4xl font-display text-[26px] font-semibold leading-tight text-paper sm:text-[34px]">{view.request || "…"}</h1>
        {view.inputs.length > 0 && (
          <p className="text-[14px] text-dim">
            {view.inputs.map((i) => i.name).join(", ")}
          </p>
        )}
        {!routed && (
          <nav aria-label="Stages" className="flex items-center gap-3">
            <StageLine reached={view.reached} active={current} failed={!!view.failure} />
          </nav>
        )}
        {!routed && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Show stage">
            {STAGES.slice(0, view.reached + 1).map((s, i) => (
              <button
                key={s}
                role="tab"
                aria-selected={i === current}
                onClick={() => setPinned(i === followed ? null : i)}
                className={cx("rounded-md px-2 py-1 text-[12px] capitalize", i === current ? "bg-iron text-paper" : "text-faint hover:text-paper")}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </header>

      <section aria-label={stage} className="min-h-[300px]">
        {routed ? (
          <div className="grid gap-5">
            <RouteCard view={view} />
            {Object.keys(view.profiles).length > 0 && <Understand view={{ ...view, route: undefined }} explain={false} />}
          </div>
        ) : stage === "understand" ? (
          <Understand view={view} explain={explain} />
        ) : stage === "draft" || stage === "test" ? (
          <Lanes view={view} explain={explain} />
        ) : stage === "choose" ? (
          <div className="grid gap-5">
            {view.ambiguity && <Ambiguity view={view} onAnswer={actions.answer} readOnly={readOnly} />}
            <Lanes view={view} explain={false} />
          </div>
        ) : stage === "preview" && view.preview ? (
          <Preview view={view} explain={explain} onFix={actions.fix} readOnly={readOnly} />
        ) : stage === "approve" && view.review ? (
          <div className="grid gap-6">
            <Passport view={view} onApprove={actions.approve} readOnly={readOnly} explain={explain} />
            {view.preview && (
              <details className="rounded-2xl border border-line p-4">
                <summary className="cursor-pointer text-[14px] text-dim">See the preview again</summary>
                <div className="mt-4">
                  <Preview view={view} explain={false} onFix={actions.fix} readOnly={readOnly} />
                </div>
              </details>
            )}
          </div>
        ) : stage === "installed" && view.installed ? (
          <Installed view={view} showcase={showcase} />
        ) : (
          <Lanes view={view} explain={explain} />
        )}
        {view.failure && <div className="mt-6"><Failure view={view} onRetry={actions.retry} onSimplify={actions.simplify} /></div>}
      </section>

      {view.examples.length > 0 && (
        <aside className="rounded-2xl border border-brass/30 p-4">
          <Eyebrow className="text-brass-hi">Confirmed examples</Eyebrow>
          <p className="mt-1 text-[13px] text-dim">{view.examples.length} example{view.examples.length === 1 ? "" : "s"} every version of this tool must reproduce. They are stored with it as regression tests.</p>
        </aside>
      )}
      <Hood view={view} events={events} />
    </div>
  );
}
