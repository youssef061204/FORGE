"use client";
import { useMemo, useState } from "react";
import { englishRecipe } from "@/core/recipe/english";
import type { Recipe } from "@/core/recipe/schema";
import type { Row } from "@/core/table";
import type { BrowserRun } from "./browser-runner";
import { BarChart, DataTable, Eyebrow, LineChart, Panel, cell, cx } from "./primitives";

/** Step through a run: the table after each step, new columns lit, dropped rows ghosted, lineage both ways. */
export function XRay({ recipe, run }: { recipe: Recipe; run: BrowserRun }) {
  const english = useMemo(() => englishRecipe(recipe).map((l) => l.text), [recipe]);
  const steps = run.snapshots ?? [];
  const [at, setAt] = useState(steps.length); // steps.length = final output
  const [outRow, setOutRow] = useState<number | null>(null);
  const [inRow, setInRow] = useState<number | null>(null);
  const slots = Object.keys(run.inputs);
  const slot = slots[0];
  const input = run.inputs[slot];
  const offset = run.offsets[slot] ?? 0;
  const out = run.outputs[0];
  const outLineage = out?.table.lineage ?? [];
  // Backward: output row -> input rows. Forward: input row -> output rows.
  const litInputs = useMemo(() => new Set(outRow === null ? [] : (outLineage[outRow] ?? [])), [outRow, outLineage]);
  const litOutputs = useMemo(() => {
    if (inRow === null) return new Set<number>();
    const id = offset + inRow;
    return new Set(outLineage.map((l, i) => (l?.includes(id) ? i : -1)).filter((i) => i >= 0));
  }, [inRow, outLineage, offset]);
  const step = at < steps.length ? steps[at] : undefined;
  const ghost = useMemo(() => {
    if (!step?.dropped?.length) return undefined;
    return step.dropped;
  }, [step]);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,2fr)]">
      <Panel className="p-3">
        <Eyebrow className="px-2 pb-2">Steps</Eyebrow>
        <ol>
          {english.map((line, i) => {
            const stepIndex = i - recipe.inputs.length;
            const isStep = stepIndex >= 0 && stepIndex < steps.length;
            const isOut = stepIndex >= steps.length;
            const active = isStep ? at === stepIndex : isOut ? at === steps.length : false;
            const snap = isStep ? steps[stepIndex] : undefined;
            return (
              <li key={i}>
                <button
                  disabled={!isStep && !isOut}
                  onClick={() => setAt(isStep ? stepIndex : steps.length)}
                  className={cx("w-full rounded-lg px-2 py-2 text-left text-[13.5px] leading-snug transition-colors", active ? "bg-iron text-paper ring-1 ring-amber/40" : "text-dim hover:bg-iron/60 hover:text-paper")}
                >
                  <span className="num mr-2 text-faint">{i + 1}.</span>
                  {line}
                  {snap && (
                    <span className="num mt-0.5 block text-[11.5px] text-faint">
                      {snap.rowsIn} → {snap.rowsOut} rows
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </Panel>
      <div className="grid min-w-0 gap-5">
        {step ? (
          <Panel tone="hot" className="p-4">
            <div className="mb-2 flex flex-wrap items-baseline gap-3">
              <Eyebrow>After step {recipe.inputs.length + step.index + 1}</Eyebrow>
              <span className="num text-[12px] text-dim">
                {step.rowsIn} rows in → {step.rowsOut} rows out
              </span>
              {step.added.length > 0 && <span className="text-[12px] text-amber">new: {step.added.join(", ")}</span>}
            </div>
            <DataTable columns={step.columns} rows={step.sample as Row[]} added={step.added} maxRows={12} dense />
            {ghost && ghost.length > 0 && (
              <div className="mt-3">
                <Eyebrow className="mb-1">Dropped by this step</Eyebrow>
                <DataTable columns={Object.keys(ghost[0].row)} rows={ghost.map((g) => g.row as Row)} ghost={new Set(ghost.map((_, i) => i))} maxRows={6} dense />
              </div>
            )}
          </Panel>
        ) : null}
        <div className="grid min-w-0 gap-5 xl:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <Eyebrow>Input · {input.total} rows</Eyebrow>
              <span className="text-[12px] text-faint">tap a row to see where it goes</span>
            </div>
            <DataTable
              columns={input.columns}
              rows={input.rows}
              rowIds={input.rows.map((_, i) => offset + i)}
              highlight={litInputs}
              onRowClick={(i) => (setInRow(inRow === i ? null : i), setOutRow(null))}
              selected={inRow ?? undefined}
              maxRows={14}
              dense
            />
          </div>
          {out && (
            <div className="min-w-0">
              <div className="mb-2 flex items-center justify-between">
                <Eyebrow>
                  {out.name} · {out.table.total} rows
                </Eyebrow>
                <span className="text-[12px] text-faint">tap a row to see where it came from</span>
              </div>
              {out.kind === "view" && out.view.x && out.view.y && out.view.type === "bar" ? (
                <div className="rounded-xl border border-line p-4">
                  <BarChart rows={out.table.rows} x={out.view.x} y={out.view.y} onBar={(i) => (setOutRow(i), setInRow(null))} active={outRow ?? undefined} />
                </div>
              ) : out.kind === "view" && out.view.x && out.view.y && out.view.type === "line" ? (
                <div className="rounded-xl border border-line p-4">
                  <LineChart rows={out.table.rows} x={out.view.x} y={out.view.y} />
                </div>
              ) : (
                <DataTable
                  columns={out.table.columns}
                  rows={out.table.rows}
                  highlight={litOutputs}
                  onRowClick={(i) => (setOutRow(outRow === i ? null : i), setInRow(null))}
                  selected={outRow ?? undefined}
                  maxRows={14}
                  dense
                />
              )}
              {outRow !== null && (
                <p className="mt-2 text-[12.5px] text-amber">
                  {litInputs.size} input row{litInputs.size === 1 ? "" : "s"} produced “{cell(out.table.rows[outRow]?.[out.table.columns[0]])}”.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
