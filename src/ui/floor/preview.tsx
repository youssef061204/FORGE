"use client";
import { useMemo, useState } from "react";
import type { BuildView } from "@/core/events/reducer";
import type { Example, FilePreview, PreviewTable } from "@/core/events/types";
import { encodeFile } from "@/core/recipe/engine";
import type { FileOutput, ViewOutput } from "@/core/recipe/schema";
import type { Json, Row } from "@/core/table";
import { BarChart, Button, DataTable, Eyebrow, Explain, LineChart, Panel, Term, cell, cx } from "../primitives";

function lineageOf(table: PreviewTable, row: number): Set<number> {
  return new Set(table.lineage?.[row] ?? []);
}

/** Input rows by global id: offset of the slot plus the row index. */
function InputPanel({ view, highlight }: { view: BuildView; highlight: Set<number> }) {
  const preview = view.preview!;
  const slots = Object.keys(preview.inputs);
  const [slot, setSlot] = useState(slots[0]);
  const t = preview.inputs[slot] ?? preview.inputs[slots[0]];
  const offset = preview.offsets[slot] ?? 0;
  const ids = t.rows.map((_, i) => offset + i);
  const hot = ids.filter((id) => highlight.has(id)).length;
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Eyebrow>Your input</Eyebrow>
        {slots.length > 1 && (
          <div className="flex gap-1">
            {slots.map((s) => (
              <button key={s} onClick={() => setSlot(s)} className={cx("rounded-md px-2 py-0.5 text-[12px]", s === slot ? "bg-ash text-paper" : "text-dim")}>
                {s}
              </button>
            ))}
          </div>
        )}
        {highlight.size > 0 && <span className="text-[12px] text-amber">{hot} row{hot === 1 ? "" : "s"} lit</span>}
      </div>
      <DataTable columns={t.columns} rows={t.rows} rowIds={ids} highlight={highlight} maxRows={14} dense caption="Input rows" />
    </div>
  );
}

function Flow({ view, selected, onSelect }: { view: BuildView; selected: number | null; onSelect: (i: number | null) => void }) {
  const p = view.preview!;
  const inputs = p.recipe.inputs;
  return (
    <ol className="relative grid gap-0" aria-label="Recipe steps">
      {p.english.map((line, i) => {
        const isInput = i < inputs.length;
        const stepIndex = i - inputs.length;
        const step = !isInput && stepIndex < p.steps.length ? p.steps[stepIndex] : undefined;
        const isOutput = !isInput && !step;
        const count = isInput ? p.inputs[inputs[i].slot]?.total : step?.rowsOut;
        return (
          <li key={i} className="relative pl-8">
            <span aria-hidden className="absolute left-[11px] top-0 h-full w-px bg-line" />
            {i < p.english.length - 1 && (
              <svg aria-hidden className="absolute left-[7px] top-6 h-[calc(100%-12px)] w-[9px] overflow-visible">
                <line x1="4.5" y1="0" x2="4.5" y2="100%" stroke="var(--color-amber)" strokeOpacity="0.7" strokeWidth="1.5" className="flow" />
              </svg>
            )}
            <span aria-hidden className={cx("absolute left-1 top-3 size-[15px] rounded-full border-2", isOutput ? "border-brass bg-brass/20" : isInput ? "border-steel bg-steel-deep" : "border-amber bg-molten/20")} />
            <button
              type="button"
              onClick={() => step && onSelect(selected === stepIndex ? null : stepIndex)}
              className={cx("my-1 w-full rounded-xl px-3 py-2 text-left transition-colors", step && "hover:bg-iron", selected === stepIndex && step && "bg-iron ring-1 ring-amber/40")}
              aria-pressed={step ? selected === stepIndex : undefined}
            >
              <span className="block text-[14px] leading-snug text-paper">
                <span className="num mr-2 text-faint">{i + 1}.</span>
                {line}
              </span>
              {count !== undefined && (
                <span className="num mt-0.5 block text-[12px] text-dim">
                  {step && step.rowsIn !== step.rowsOut ? `${step.rowsIn} → ` : ""}
                  {count} rows
                  {step?.added.length ? <span className="ml-2 text-amber">+ {step.added.join(", ")}</span> : null}
                  {step?.removed.length ? <span className="ml-2 text-faint">− {step.removed.slice(0, 4).join(", ")}</span> : null}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function OutputView({
  file,
  view,
  onPick,
  picked,
  fixing,
  onFix,
}: {
  file: FilePreview;
  view: BuildView;
  onPick: (row: number) => void;
  picked: number | null;
  fixing: boolean;
  onFix: (example: Example) => void;
}) {
  const p = view.preview!;
  const spec = p.recipe.outputs.find((o) => (o.kind === "file" ? o.name === file.name : `view:${o.type}` === file.name));
  const [rows, setRows] = useState<Row[]>(file.table.rows);
  const [editing, setEditing] = useState<{ r: number; c: string } | null>(null);
  const dirty = JSON.stringify(rows) !== JSON.stringify(file.table.rows);
  if (spec?.kind === "view") {
    const v = spec as ViewOutput;
    if ((v.type === "bar" || v.type === "line") && v.x && v.y)
      return (
        <div className="rounded-xl border border-line p-4">
          {v.type === "bar" ? <BarChart rows={file.table.rows} x={v.x} y={v.y} onBar={onPick} active={picked ?? undefined} /> : <LineChart rows={file.table.rows} x={v.x} y={v.y} />}
        </div>
      );
    if (v.type === "stat") {
      const col = v.y ?? file.table.columns.at(-1)!;
      return (
        <button className="w-full rounded-xl border border-line p-6 text-left" onClick={() => onPick(0)}>
          <Eyebrow>{v.title ?? col}</Eyebrow>
          <div className="num mt-2 text-5xl text-steel-hi">{cell(file.table.rows[0]?.[col])}</div>
        </button>
      );
    }
  }
  const submit = () => {
    const out = spec as FileOutput;
    const table = { columns: file.table.columns, rows };
    let expected: Json;
    try {
      const enc = encodeFile(out, table, out.columns ?? file.table.columns);
      expected = enc.value !== undefined ? enc.value : rows.map((r) => Object.fromEntries(file.table.columns.map((c) => [c, r[c] ?? null])));
    } catch {
      expected = rows as unknown as Json;
    }
    onFix({ id: `fix${Date.now()}`, kind: rows.length < file.table.rows.length ? "remove-row" : "edit-cell", input: p.inputs, output: file.name, expected, note: "corrected by hand in the preview" });
  };
  return (
    <div>
      {fixing ? (
        <div className="overflow-x-auto rounded-xl border border-brass/40">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line bg-iron/60">
                {file.table.columns.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-medium text-dim">
                    {c}
                  </th>
                ))}
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 30).map((r, i) => (
                <tr key={i} className="border-b border-line/60">
                  {file.table.columns.map((c) => (
                    <td key={c} className="px-1 py-0.5">
                      {editing?.r === i && editing.c === c ? (
                        <input
                          autoFocus
                          defaultValue={cell(r[c])}
                          aria-label={`Edit ${c} in row ${i + 1}`}
                          className="num w-full rounded bg-ash px-2 py-1 text-paper outline-none ring-1 ring-brass"
                          onBlur={(e) => {
                            const raw = e.target.value;
                            const orig = r[c];
                            const value: Json = typeof orig === "number" && raw.trim() !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
                            setRows(rows.map((x, k) => (k === i ? { ...x, [c]: value } : x)));
                            setEditing(null);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        />
                      ) : (
                        <button className="num w-full rounded px-2 py-1 text-left hover:bg-iron" onClick={() => setEditing({ r: i, c })}>
                          {cell(r[c]) || <span className="text-faint">·</span>}
                        </button>
                      )}
                    </td>
                  ))}
                  <td>
                    <button aria-label={`Remove row ${i + 1}`} className="px-2 text-faint hover:text-[#f1a99b]" onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3 border-t border-line p-3">
            <Button tone="brass" size="sm" disabled={!dirty} onClick={submit}>
              Rebuild to match this
            </Button>
            <span className="text-[12px] text-dim">Every surviving draft must reproduce your corrected result. It becomes a permanent test.</span>
          </div>
        </div>
      ) : (
        <DataTable columns={file.table.columns} rows={file.table.rows} onRowClick={onPick} selected={picked ?? undefined} maxRows={14} caption={`Result ${file.name}`} />
      )}
    </div>
  );
}

export function Preview({ view, explain, onFix, readOnly }: { view: BuildView; explain: boolean; onFix?: (e: Example) => void; readOnly?: boolean }) {
  const p = view.preview!;
  const [selected, setSelected] = useState<number | null>(null);
  const files = p.outputs;
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [fixing, setFixing] = useState(false);
  const file = files[Math.min(active, files.length - 1)];
  const highlight = useMemo(() => (picked === null || !file ? new Set<number>() : lineageOf(file.table, picked)), [picked, file]);
  const step = selected !== null ? p.steps[selected] : undefined;
  return (
    <div className="grid gap-5">
      <Explain show={explain}>
        This is the winning draft as a recipe, rendered from the program itself, not from the model. Your real rows flow through each step. Tap a result row to light up the{" "}
        <Term term="lineage">input rows that produced it</Term>.
      </Explain>
      {p.provisional && (
        <p className="rounded-lg border border-amber/40 bg-molten/10 px-3 py-2 text-[13px] text-amber" role="status">
          Provisional: the first draft to pass. Other drafts are still being tested.
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.6fr)]">
        <Panel className="p-4">
          <Eyebrow className="mb-2">Recipe</Eyebrow>
          <Flow view={view} selected={selected} onSelect={setSelected} />
        </Panel>
        <div className="grid min-w-0 gap-5">
          {step ? (
            <Panel tone="hot" className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <Eyebrow>After step {p.recipe.inputs.length + step.index + 1}</Eyebrow>
                <button className="text-[12px] text-dim hover:text-paper" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
              <DataTable columns={step.columns} rows={step.sample} added={step.added} maxRows={12} dense />
            </Panel>
          ) : null}
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <InputPanel view={view} highlight={highlight} />
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Eyebrow>Result</Eyebrow>
                {files.map((f, i) => (
                  <button key={f.name} onClick={() => (setActive(i), setPicked(null))} className={cx("rounded-md px-2 py-0.5 font-mono text-[12px]", i === active ? "bg-ash text-paper" : "text-dim hover:text-paper")}>
                    {f.name.startsWith("view:") ? f.name.slice(5) + " chart" : f.name}
                  </button>
                ))}
                {!readOnly && onFix && file && !file.name.startsWith("view:") && (
                  <button onClick={() => setFixing(!fixing)} className="ml-auto text-[12px] text-brass-hi hover:underline">
                    {fixing ? "Cancel fix" : "Something's wrong? Fix it by example"}
                  </button>
                )}
              </div>
              {file && <OutputView key={file.name + String(fixing)} file={file} view={view} onPick={setPicked} picked={picked} fixing={fixing} onFix={(e) => (setFixing(false), onFix?.(e))} />}
              {file && !file.name.startsWith("view:") && (
                <p className="num mt-2 text-[12px] text-faint">
                  {file.name} · {file.table.total} rows · {file.bytes.toLocaleString()} bytes
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Ambiguity({ view, onAnswer, readOnly }: { view: BuildView; onAnswer?: (cluster: string) => void; readOnly?: boolean }) {
  const a = view.ambiguity!;
  const inputs = Object.entries(a.input);
  return (
    <Panel tone="brass" className="p-5">
      <Eyebrow className="text-brass-hi">Which did you mean?</Eyebrow>
      <h3 className="mt-1 font-display text-2xl font-semibold">{a.question}</h3>
      <p className="mt-1 text-[14px] text-dim">FORGE found the smallest example where the two readings disagree.</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="min-w-0">
          <Eyebrow className="mb-2">For this input</Eyebrow>
          {inputs.map(([slot, t]) => (
            <DataTable key={slot} columns={t.columns} rows={t.rows} dense maxRows={8} />
          ))}
        </div>
        {a.options.map((o, i) => (
          <div key={o.cluster} className={cx("min-w-0 rounded-xl border p-3", a.resolved === o.cluster ? "border-steel-hi/60 bg-steel-deep/30" : "border-line")}>
            <Eyebrow className="mb-2">Reading {i + 1}</Eyebrow>
            <DataTable columns={o.output.columns} rows={o.output.rows} dense maxRows={8} />
            <ul className="mt-2 space-y-0.5 text-[12px] text-dim">
              {o.english.slice(0, 5).map((line, k) => (
                <li key={k}>{line}</li>
              ))}
            </ul>
            {!readOnly && !a.resolved && onAnswer && (
              <Button tone="brass" size="sm" className="mt-3" onClick={() => onAnswer(o.cluster)}>
                This one
              </Button>
            )}
            {a.resolved === o.cluster && <p className="mt-3 text-[13px] text-steel-hi">Chosen. Saved as a permanent example.</p>}
          </div>
        ))}
      </div>
    </Panel>
  );
}
