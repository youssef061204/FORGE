"use client";
/**
 * FORGE design-system primitives. Color is never the only signal: every
 * state also carries a label or an icon.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Json, Row } from "@/core/table";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

// Buttons ----------------------------------------------------------------------
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "molten" | "steel" | "ghost" | "brass" | "slag"; size?: "sm" | "md" | "lg" };
export function Button({ tone = "steel", size = "md", className, ...rest }: ButtonProps) {
  const tones = {
    molten: "bg-gradient-to-b from-amber to-molten text-ink font-semibold shadow-[0_0_0_1px_rgb(255_176_74/0.4),0_8px_30px_-8px_rgb(255_106_31/0.6)] hover:brightness-110",
    steel: "bg-iron text-paper border border-line-strong hover:border-steel/60 hover:bg-ash",
    ghost: "text-dim hover:text-paper hover:bg-iron",
    brass: "bg-brass/15 text-brass-hi border border-brass/50 hover:bg-brass/25",
    slag: "bg-slag/15 text-[#f1a99b] border border-slag/50 hover:bg-slag/25",
  };
  const sizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4 text-[15px]", lg: "h-12 px-6 text-base" };
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg transition-[background,filter,border-color,color] duration-200 disabled:opacity-40 disabled:pointer-events-none select-none whitespace-nowrap",
        tones[tone],
        sizes[size],
        className,
      )}
      {...rest}
    />
  );
}

// Provenance --------------------------------------------------------------------
export function ProvenanceBadge({ provenance, model, recordedAt, hardware }: { provenance: string; model?: string; recordedAt?: string; hardware?: string }) {
  const label = provenance === "live" ? "LIVE" : provenance === "recorded" ? "RECORDED" : "SCRIPTED";
  const detail =
    provenance === "live"
      ? `${model ?? "local model"} is generating now`
      : provenance === "recorded"
        ? `A real past run${model ? ` by ${model}` : ""}${hardware ? ` on ${hardware}` : ""}${recordedAt ? `, ${new Date(recordedAt).toLocaleDateString()}` : ""}`
        : "A deterministic stand-in. No model involved.";
  return (
    <span
      title={detail}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] border",
        provenance === "live" && "border-molten/60 text-amber bg-molten/10",
        provenance === "recorded" && "border-steel/50 text-steel-hi bg-steel-deep/40",
        provenance === "scripted" && "border-line-strong text-dim bg-iron",
      )}
    >
      <span aria-hidden className={cx("size-1.5 rounded-full", provenance === "live" ? "bg-molten ember" : provenance === "recorded" ? "bg-steel" : "bg-faint")} />
      {label}
      <span className="sr-only">: {detail}</span>
    </span>
  );
}

// Surfaces ----------------------------------------------------------------------
export function Panel({ children, className, tone }: { children: ReactNode; className?: string; tone?: "hot" | "steel" | "brass" | "slag" }) {
  return (
    <div
      className={cx(
        "relative rounded-2xl border bg-coal/80 backdrop-blur-[2px]",
        tone === "hot" ? "border-molten/40 shadow-[0_0_60px_-30px_rgb(255_106_31/0.7)]" : tone === "brass" ? "border-brass/40" : tone === "slag" ? "border-slag/50" : tone === "steel" ? "border-steel/30" : "border-line",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("text-[11px] font-semibold uppercase tracking-[0.18em] text-faint", className)}>{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-iron px-1.5 py-0.5 font-mono text-[11px] text-dim">{children}</kbd>;
}

// Jargon -------------------------------------------------------------------------
export const GLOSSARY: Record<string, string> = {
  MCP: "Model Context Protocol: the standard way AI assistants discover and call tools.",
  recipe: "A short, step-by-step program FORGE writes for your data. It can only read what you hand it and compute a result.",
  sandbox: "A sealed room where the tool runs. It has no network, no other files, and a stopwatch.",
  permission: "Exactly what an approved tool is allowed to touch. Anything else is refused.",
  draft: "One attempt by the model to write the tool. FORGE writes several and lets their behavior vote.",
  lineage: "Which input rows produced a given result.",
  hash: "A fingerprint of the exact program. Change one character and the fingerprint changes, so approval no longer applies.",
};
export function Term({ children, term }: { children: ReactNode; term: keyof typeof GLOSSARY | string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const def = GLOSSARY[term];
  if (!def) return <>{children}</>;
  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-describedby={id}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="underline decoration-dotted decoration-faint underline-offset-4 hover:decoration-amber"
      >
        {children}
      </button>
      <span
        role="tooltip"
        id={id}
        className={cx(
          "pointer-events-none absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-lg border border-line-strong bg-ash p-3 text-left text-[13px] leading-snug text-paper shadow-xl transition-opacity duration-150",
          open ? "opacity-100" : "opacity-0",
        )}
      >
        {def}
      </span>
    </span>
  );
}

// Stage line ---------------------------------------------------------------------
export const STAGE_LABELS = ["Understand", "Draft", "Test", "Choose", "Preview", "Approve", "Installed"];
export function StageLine({ reached, active, failed }: { reached: number; active: number; failed?: boolean }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Build progress">
      {STAGE_LABELS.map((label, i) => {
        const state = failed && i === active ? "failed" : i < reached || (i === reached && i === STAGE_LABELS.length - 1) ? "done" : i === active ? "active" : i <= reached ? "done" : "todo";
        return (
          <li key={label} className="flex items-center gap-1" aria-current={state === "active" ? "step" : undefined}>
            <span
              className={cx(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap transition-colors duration-500",
                state === "active" && "bg-molten/15 text-amber",
                state === "done" && "text-steel-hi",
                state === "todo" && "text-faint",
                state === "failed" && "bg-slag/15 text-[#f1a99b]",
              )}
            >
              <span aria-hidden className={cx("size-1.5 rounded-full", state === "active" && "bg-molten ember", state === "done" && "bg-steel", state === "todo" && "bg-ash", state === "failed" && "bg-slag")} />
              {label}
              <span className="sr-only">{state === "done" ? " (done)" : state === "active" ? " (in progress)" : state === "failed" ? " (failed)" : ""}</span>
            </span>
            {i < STAGE_LABELS.length - 1 && <span aria-hidden className={cx("h-px w-3 sm:w-5", i < reached ? "bg-steel/50" : "bg-line")} />}
          </li>
        );
      })}
    </ol>
  );
}

// Tables -------------------------------------------------------------------------
export function cell(v: Json | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number") return String(Number(v.toPrecision(15)));
  return String(v);
}
export function DataTable({
  columns,
  rows,
  highlight,
  added,
  ghost,
  onRowClick,
  selected,
  maxRows = 12,
  caption,
  rowIds,
  dense,
}: {
  columns: string[];
  rows: Row[];
  highlight?: Set<number>;
  added?: string[];
  ghost?: Set<number>;
  onRowClick?: (i: number) => void;
  selected?: number;
  maxRows?: number;
  caption?: string;
  rowIds?: number[];
  dense?: boolean;
}) {
  const shown = rows.slice(0, maxRows);
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className={cx("w-full border-collapse text-left", dense ? "text-[12px]" : "text-[13px]")}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line bg-iron/60">
            {columns.map((c) => (
              <th key={c} scope="col" className={cx("px-3 py-2 font-medium whitespace-nowrap", added?.includes(c) ? "text-amber" : "text-dim")}>
                {c}
                {added?.includes(c) && <span className="ml-1 text-[10px] text-amber/80">new</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            const id = rowIds?.[i] ?? i;
            const hot = highlight?.has(id);
            const dead = ghost?.has(id);
            return (
              <tr
                key={i}
                onClick={onRowClick ? () => onRowClick(i) : undefined}
                className={cx(
                  "border-b border-line/60 last:border-0 transition-colors duration-300",
                  onRowClick && "cursor-pointer hover:bg-iron",
                  hot && "bg-molten/12",
                  selected === i && "bg-steel-deep/50",
                  dead && "opacity-35 line-through decoration-slag/60",
                )}
              >
                {columns.map((c) => (
                  <td key={c} className={cx("px-3 whitespace-nowrap num", dense ? "py-1" : "py-1.5", hot ? "text-hot" : "text-paper/90", added?.includes(c) && "text-amber")}>
                    {cell(r[c]) || <span className="text-faint">·</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > maxRows && <div className="border-t border-line px-3 py-1.5 text-[12px] text-faint">{rows.length - maxRows} more rows</div>}
    </div>
  );
}

// Charts (SVG, no library) --------------------------------------------------------
export function BarChart({ rows, x, y, height = 200, onBar, active }: { rows: Row[]; x: string; y: string; height?: number; onBar?: (i: number) => void; active?: number }) {
  const data = rows.slice(0, 24).map((r) => ({ label: cell(r[x]), value: Number(r[y]) || 0 }));
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <figure aria-label={`Bar chart of ${y} by ${x}`} className="w-full">
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onBar?.(i)}
            className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5 min-w-0"
            aria-label={`${d.label}: ${d.value}`}
          >
            <span className="num text-[11px] text-dim group-hover:text-paper">{fmt(d.value)}</span>
            <span
              className={cx("w-full rounded-t-md transition-[height,background] duration-700 ease-[var(--ease-forge)]", active === i ? "bg-gradient-to-t from-molten to-amber" : "bg-gradient-to-t from-steel-deep to-steel/80 group-hover:to-steel-hi")}
              style={{ height: `${(Math.abs(d.value) / max) * (height - 40)}px` }}
            />
            <span className="w-full truncate text-center text-[11px] text-faint">{d.label}</span>
          </button>
        ))}
      </div>
    </figure>
  );
}
export function LineChart({ rows, x, y, height = 180 }: { rows: Row[]; x: string; y: string; height?: number }) {
  const data = rows.slice(0, 200).map((r) => ({ label: cell(r[x]), value: Number(r[y]) || 0 }));
  const w = 600;
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const pts = data.map((d, i) => [data.length === 1 ? w / 2 : (i / (data.length - 1)) * w, height - 24 - ((d.value - min) / (max - min || 1)) * (height - 44)]);
  return (
    <figure aria-label={`Line chart of ${y} by ${x}`}>
      <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img">
        <polyline fill="none" stroke="var(--color-steel)" strokeWidth="2" points={pts.map((p) => p.join(",")).join(" ")} />
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p[0]} cy={p[1]} r="3.5" fill="var(--color-amber)" />
            <text x={p[0]} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--color-faint)">
              {data[i].label}
            </text>
            <text x={p[0]} y={p[1] - 8} textAnchor="middle" fontSize="11" fill="var(--color-dim)">
              {fmt(data[i].value)}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
export function fmt(n: number) {
  return Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(Math.round(n * 100) / 100);
}

// Hold to approve ---------------------------------------------------------------
/** Press and hold for 1.2 s. Keyboard: hold Space or Enter. Cancels on release. */
export function HoldSeal({ onSealed, disabled, label = "Hold to approve" }: { onSealed: () => void; disabled?: boolean; label?: string }) {
  const [progress, setProgress] = useState(0);
  const [sealed, setSealed] = useState(false);
  const raf = useRef<number | null>(null);
  const start = useRef<number | null>(null);
  const DURATION = 1200;
  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    start.current = null;
    if (!sealed) setProgress(0);
  }, [sealed]);
  const onSealedRef = useRef(onSealed);
  useEffect(() => {
    onSealedRef.current = onSealed;
  }, [onSealed]);
  const begin = () => {
    if (disabled || sealed || raf.current) return;
    const tick = (t: number) => {
      if (start.current === null) start.current = t;
      const p = Math.min(1, (t - start.current) / DURATION);
      setProgress(p);
      if (p >= 1) {
        setSealed(true);
        raf.current = null;
        onSealedRef.current();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => stop(), [stop]);
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={sealed ? "Approved" : `${label}: press and hold`}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && (e.preventDefault(), begin())}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
      className={cx("group relative flex select-none items-center gap-4 rounded-2xl border px-5 py-3 transition-colors duration-300 touch-none", sealed ? "border-steel/50 bg-steel-deep/30" : "border-brass/50 bg-brass/10 hover:bg-brass/15", disabled && "opacity-40")}
    >
      <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden className="shrink-0">
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgb(202 162 76 / 0.25)" strokeWidth="4" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={sealed ? "var(--color-steel-hi)" : "var(--color-brass-hi)"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - progress)}
          transform="rotate(-90 40 40)"
        />
        <g style={{ transform: `scale(${sealed ? 1 : 0.7 + progress * 0.3})`, transformOrigin: "40px 40px", transition: sealed ? "transform 300ms var(--ease-forge)" : undefined }}>
          <circle cx="40" cy="40" r="22" fill={sealed ? "var(--color-steel-deep)" : `rgb(202 162 76 / ${0.12 + progress * 0.5})`} />
          <path d={sealed ? "M30 40 l7 7 l14 -15" : "M40 28 v24 M28 40 h24"} stroke={sealed ? "var(--color-steel-hi)" : "var(--color-brass-hi)"} strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
      <span className="text-left">
        <span className={cx("block font-display text-lg font-semibold", sealed ? "text-steel-hi cooling" : "text-brass-hi")}>{sealed ? "Approved and sealed" : label}</span>
        <span className="block text-[13px] text-dim">{sealed ? "Bound to this exact program" : "Press and hold. Release to cancel."}</span>
      </span>
    </button>
  );
}

export function Spinner({ label = "Working" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-[13px] text-amber">
      <span aria-hidden className="size-2 rounded-full bg-molten ember" />
      {label}
    </span>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line-strong p-8">
      <div className="font-display text-xl text-paper">{title}</div>
      {children && <div className="max-w-prose text-dim">{children}</div>}
      {action}
    </div>
  );
}

export function Explain({ children, show = true }: { children: ReactNode; show?: boolean }) {
  if (!show) return null;
  return (
    <p className="flex gap-2 text-[14px] leading-relaxed text-dim">
      <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-amber" />
      <span>{children}</span>
    </p>
  );
}
