"use client";
import { useEffect, useRef, type ReactNode } from "react";
import {
  X,
  DoorClosed,
  Moon,
  Cpu,
  Sparkles,
  Flame,
  ShieldCheck,
  Check,
} from "lucide-react";
import type { BuildProgress, Execution, Release } from "@/forge/records";

export function AbilityIcon({ id, size = 24 }: { id: string; size?: number }) {
  return id === "leaving-home" ? (
    <DoorClosed size={size} />
  ) : id === "welcome-home" ? (
    <Moon size={size} />
  ) : id === "study-mode" ? (
    <Cpu size={size} />
  ) : (
    <Sparkles size={size} />
  );
}

export function GameDialog({
  open,
  onClose,
  title,
  children,
  kind = "",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  kind?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`world-dialog ${kind}`}
      onClose={onClose}
      aria-label={title}
    >
      <header>
        <div>
          <span className="pixel-label">FORGE WORLD</span>
          <h2>{title}</h2>
        </div>
        <button onClick={onClose} aria-label={`Close ${title}`} autoFocus>
          <X size={20} />
        </button>
      </header>
      <div className="world-dialog-body">{children}</div>
    </dialog>
  );
}

export function Forging({
  progress,
  release,
  working,
}: {
  progress?: BuildProgress;
  release?: Release;
  working: boolean;
}) {
  const primitives = release?.definition.nodes
    .slice(0, 4)
    .map((n) => n.operation);
  return (
    <div
      className={`forge-ritual ${working ? "is-forging" : "is-forged"}`}
      aria-live="polite"
    >
      <div className="ritual-tools">
        {primitives?.map((p, i) => (
          <code key={p} style={{ animationDelay: `${i * 130}ms` }}>
            {p}
          </code>
        )) ?? <span>Reading trusted primitives</span>}
      </div>
      <div className="pixel-anvil">
        <Flame size={32} />
        <i />
        <b />
        <span className="forge-sparks">✦</span>
      </div>
      <span className="pixel-label">
        {working
          ? "FORGING A NEW ABILITY"
          : release?.report.passed
            ? "NEW ABILITY · VALIDATED"
            : "VALIDATION BLOCKED"}
      </span>
      <strong>
        {working
          ? (progress?.stages.at(-1)?.name ?? "Request sent to MCP compiler")
          : release?.definition.name}
      </strong>
      {!working && release && (
        <small>
          {release.report.checks.filter((c) => c.passed).length}/
          {release.report.checks.length} actual checks · owner approval required
        </small>
      )}
    </div>
  );
}

export function WorldEventFeed({ execution }: { execution?: Execution }) {
  if (!execution) return null;
  return (
    <div
      className="world-event-feed"
      key={execution.id}
      aria-label="Recorded broker steps"
    >
      <span className="pixel-label">
        {execution.status === "success" ? "WORLD UPDATED" : "EXECUTION FAILED"}{" "}
        · {execution.trace.length} BROKER STEPS
      </span>
      {execution.trace
        .filter((s) => !s.operation.endsWith(".read"))
        .slice(-5)
        .map((step, i) => (
          <div key={step.nodeId} style={{ animationDelay: `${i * 110}ms` }}>
            {step.status === "success" ? (
              <Check size={12} />
            ) : (
              <ShieldCheck size={12} />
            )}
            <code>{step.operation}</code>
            <small>{step.status}</small>
          </div>
        ))}
    </div>
  );
}
