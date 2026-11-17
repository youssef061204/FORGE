"use client";
import type { BuildView } from "@/core/events/reducer";
import { CAPABILITIES } from "@/core/contracts/capabilities";
import { DataTable, Eyebrow, Explain, Panel, cx } from "../primitives";

const KIND: Record<string, string> = {
  number: "number",
  integer: "whole number",
  date: "date",
  boolean: "yes/no",
  text: "text",
  empty: "empty",
  list: "list",
  object: "nested",
  mixed: "mixed",
};

export function Understand({ view, explain }: { view: BuildView; explain: boolean }) {
  const profiles = Object.entries(view.profiles);
  return (
    <div className="grid gap-5">
      <Explain show={explain}>FORGE reads your file first, without any model: what columns it has, what kind of values they hold, a few real rows.</Explain>
      {profiles.map(([slot, p]) => (
        <Panel key={slot} className="p-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="font-display text-xl font-semibold">{p.name}</h3>
            <span className="num text-[13px] text-dim">
              {p.rows.toLocaleString()} rows · {p.columns.length} columns
            </span>
          </div>
          <ul className="mt-4 flex flex-wrap gap-2">
            {p.columns.map((c) => (
              <li key={c.name} className="rounded-lg border border-line bg-iron/60 px-2.5 py-1.5 text-[13px]">
                <span className="font-medium text-paper">{c.name}</span>
                <span className={cx("ml-2 text-[12px]", c.kind === "number" || c.kind === "integer" ? "text-steel-hi" : c.kind === "date" ? "text-brass-hi" : "text-faint")}>{KIND[c.kind] ?? c.kind}</span>
                {c.nulls > 0 && <span className="ml-2 text-[11px] text-faint">{c.nulls} blank</span>}
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <DataTable columns={p.sample.length ? Object.keys(p.sample[0]) : p.columns.map((c) => c.name)} rows={p.sample} maxRows={5} dense caption={`First rows of ${p.name}`} />
          </div>
        </Panel>
      ))}
      {view.intent && (
        <Panel className="p-5">
          <Eyebrow>FORGE&apos;s reading of your request</Eyebrow>
          <p className="mt-2 font-display text-[22px] leading-snug text-paper">{view.intent.restatement}</p>
          {view.intent.needs.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2 text-[12px]">
              {view.intent.needs.map((n) => (
                <li key={n} className={cx("rounded-full border px-2.5 py-1", CAPABILITIES[n]?.connected ? "border-steel/40 text-steel-hi" : "border-slag/60 text-[#f1a99b]")}>
                  {CAPABILITIES[n]?.connected ? "✓" : "✕"} {CAPABILITIES[n]?.label ?? n}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {view.route && view.route.route !== "SYNTHESIZE" && <RouteCard view={view} />}
    </div>
  );
}

export function RouteCard({ view }: { view: BuildView }) {
  const r = view.route!;
  const tone = r.route === "CONNECT" || r.route === "UNSUPPORTED" ? "slag" : r.route === "CLARIFY" ? "brass" : "steel";
  const title =
    r.route === "CONNECT"
      ? "FORGE can't do this yet"
      : r.route === "UNSUPPORTED"
        ? "This isn't something a recipe can do"
        : r.route === "CLARIFY"
          ? "One question first"
          : r.route === "REUSE"
            ? "You already have this tool"
            : "Changing an existing tool";
  return (
    <Panel tone={tone} className="p-5">
      <Eyebrow className={tone === "slag" ? "text-[#f1a99b]" : undefined}>{r.route}</Eyebrow>
      <h3 className="mt-1 font-display text-2xl font-semibold">{title}</h3>
      <p className="mt-2 max-w-prose text-dim">{r.question ?? r.reason}</p>
      {r.missing && r.missing.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-[13px]">
          {r.missing.map((m) => (
            <li key={m} className="rounded-full border border-slag/60 bg-slag-deep/50 px-3 py-1 text-[#f1a99b]">
              Needs: {CAPABILITIES[m]?.label ?? m}
            </li>
          ))}
        </ul>
      )}
      {r.route === "CONNECT" && <p className="mt-3 text-[14px] text-faint">No program was generated, and nothing was claimed as done.</p>}
    </Panel>
  );
}
