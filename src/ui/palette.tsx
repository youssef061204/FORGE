"use client";
/** Command palette: Ctrl/⌘+K. Every destination and sample, keyboard first. */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SAMPLES } from "@/showcase/samples";
import { cx } from "./primitives";

type Item = { label: string; hint: string; go: string };

const PAGES: Item[] = [
  { label: "Forge a tool", hint: "Home", go: "/#build" },
  { label: "Watch a tool get built", hint: "Tour", go: "/tour" },
  { label: "Toolbox", hint: "Your approved tools", go: "/tools" },
  { label: "Assistants", hint: "Connect over MCP", go: "/assistants" },
  { label: "Safety Lab", hint: "Fire eleven attacks", go: "/safety" },
  { label: "Scorecard", hint: "Measured results", go: "/scorecard" },
  { label: "Activity", hint: "Receipts", go: "/activity" },
  { label: "Settings", hint: "Model and data", go: "/settings" },
];

export function Palette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => {
    const all: Item[] = [...PAGES, ...SAMPLES.flatMap((s) => s.requests.map((r) => ({ label: r.text, hint: `Watch: ${s.title}`, go: `/forge/tape-${s.id}-${r.level}` })))];
    const t = q.toLowerCase().trim();
    return (t ? all.filter((x) => `${x.label} ${x.hint}`.toLowerCase().includes(t)) : all).slice(0, 12);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQ("");
        setI(0);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) requestAnimationFrame(() => input.current?.focus());
  }, [open]);
  if (!open) return null;
  const go = (it: Item) => {
    setOpen(false);
    router.push(it.go);
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-ink/70 px-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-coal shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={q}
          onChange={(e) => (setQ(e.target.value), setI(0))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setI((x) => Math.min(items.length - 1, x + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setI((x) => Math.max(0, x - 1));
            }
            if (e.key === "Enter" && items[i]) go(items[i]);
          }}
          placeholder="Go to a page or watch a sample build…"
          aria-label="Search"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[i] ? `palette-${i}` : undefined}
          className="w-full border-b border-line bg-transparent px-4 py-3.5 text-[16px] text-paper placeholder:text-faint focus:outline-none"
        />
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-auto p-2">
          {items.map((it, k) => (
            <li key={it.go + it.label} id={`palette-${k}`} role="option" aria-selected={k === i}>
              <button onMouseEnter={() => setI(k)} onClick={() => go(it)} className={cx("flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[14px]", k === i ? "bg-iron text-paper" : "text-dim")}>
                <span className="truncate">{it.label}</span>
                <span className="shrink-0 text-[12px] text-faint">{it.hint}</span>
              </button>
            </li>
          ))}
          {!items.length && <li className="px-3 py-2 text-[14px] text-faint">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}
