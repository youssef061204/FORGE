"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Eyebrow, Panel, Term, cx } from "./primitives";

type Wire = { session: string; direction: "in" | "out"; message: unknown; caption: string; at: string };

function Snippet({ title, note, code }: { title: string; note: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-[17px] font-semibold">{title}</span>
        <button
          className="text-[12px] text-amber hover:underline"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1 text-[13px] text-dim">{note}</p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-[12px] text-paper/85">{code}</pre>
    </Panel>
  );
}

export function Assistants({ showcase }: { showcase: boolean }) {
  const [wire, setWire] = useState<Wire[]>([]);
  const [sessions, setSessions] = useState<{ id: string; client?: string; tools: string[] }[]>([]);
  const [sim, setSim] = useState<{ steps: { text: string; buildId?: string }[]; running: boolean }>({ steps: [], running: false });
  const [cwd, setCwd] = useState("C:\\path\\to\\FORGE");
  const [open, setOpen] = useState<number | null>(null);
  const endpoint = "http://127.0.0.1:3110/api/mcp";
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (showcase) return;
    const load = () =>
      fetch("/api/assistants")
        .then((r) => r.json())
        .then((d) => {
          setSessions(d.sessions ?? []);
          setSim(d.simulation ?? { steps: [], running: false });
          if (d.cwd) setCwd(d.cwd);
        })
        .catch(() => undefined);
    void load();
    const t = setInterval(load, 3000);
    const es = new EventSource("/api/events");
    es.addEventListener("mcp.wire", (m) => setWire((w) => [...w.slice(-199), JSON.parse((m as MessageEvent).data) as Wire]));
    return () => {
      clearInterval(t);
      es.close();
    };
  }, [showcase]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [wire.length]);
  const desktopPath = `${cwd.replace(/\\/g, "\\\\")}\\\\bin\\\\forge.mjs`;
  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-10 sm:px-6">
      <div>
        <h1 className="font-display text-4xl font-semibold">Assistants</h1>
        <p className="mt-2 max-w-2xl text-dim">
          Any <Term term="MCP">MCP</Term> assistant can connect to FORGE. It sees three tools for asking FORGE, plus every tool you approved. The moment you approve or revoke one, a connected assistant is told.
        </p>
      </div>
      {showcase ? (
        <Panel className="p-5 text-dim">The showcase has no MCP endpoint. Run FORGE on your computer to connect Claude Code, Claude Desktop or Cursor.</Panel>
      ) : (
        <>
          <Panel tone="steel" className="flex flex-wrap items-center gap-4 p-5">
            <div>
              <Eyebrow>Endpoint</Eyebrow>
              <div className="mt-1 font-mono text-[15px] text-steel-hi">{endpoint}</div>
            </div>
            <p className="max-w-md text-[13px] text-dim">Streamable HTTP with sessions. Loopback only. An assistant can ask for tools; it can never approve one.</p>
            <span className="ml-auto text-[13px] text-faint">
              {sessions.length} connected{sessions.length ? `: ${sessions.map((s) => s.client ?? "client").join(", ")}` : ""}
            </span>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-3">
            <Snippet title="Claude Code" note="Run in a terminal." code={`claude mcp add --transport http forge ${endpoint}`} />
            <Snippet title="Cursor" note="In .cursor/mcp.json (or the global mcp.json)." code={`{\n  "mcpServers": {\n    "forge": { "url": "${endpoint}" }\n  }\n}`} />
            <Snippet
              title="Claude Desktop"
              note="Desktop starts local servers over stdio; this bridge relays to FORGE. Edit claude_desktop_config.json, then restart."
              code={`{\n  "mcpServers": {\n    "forge": {\n      "command": "node",\n      "args": ["${desktopPath}", "mcp"]\n    }\n  }\n}`}
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-[1fr_1.4fr]">
            <Panel className="p-5">
              <Eyebrow>Simulate an assistant</Eyebrow>
              <p className="mt-2 text-[14px] text-dim">
                A real MCP client connects to this FORGE, lists its tools, finds none that fits, asks FORGE for one, waits for you to approve it, lists again and calls it.
              </p>
              <Button tone="molten" className="mt-4" disabled={sim.running} onClick={() => fetch("/api/assistants", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })}>
                {sim.running ? "Running…" : "Simulate an assistant"}
              </Button>
              <ol className="mt-4 space-y-2 text-[14px]">
                {sim.steps.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="num text-faint">{i + 1}.</span>
                    <span>
                      {s.text}
                      {s.buildId && (
                        <Link href={`/forge/${s.buildId}`} className="ml-2 text-amber hover:underline">
                          Review and approve →
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </Panel>
            <Panel className="flex min-h-[360px] flex-col p-5">
              <div className="flex items-center justify-between">
                <Eyebrow>Live wire</Eyebrow>
                <span className="text-[12px] text-faint">JSON-RPC between assistants and FORGE, captioned</span>
              </div>
              <ol ref={log} className="mt-3 max-h-[460px] flex-1 space-y-1 overflow-auto font-mono text-[12px]" aria-live="polite">
                {wire.length === 0 && <li className="text-faint">Waiting for an assistant…</li>}
                {wire.map((w, i) => (
                  <li key={i}>
                    <button className="flex w-full gap-2 rounded px-1 text-left hover:bg-iron" onClick={() => setOpen(open === i ? null : i)}>
                      <span className={cx("w-8 shrink-0", w.direction === "in" ? "text-steel" : "text-amber")}>{w.direction === "in" ? "→" : "←"}</span>
                      <span className="text-paper/85">{w.caption}</span>
                    </button>
                    {open === i && <pre className="ml-10 overflow-x-auto rounded bg-ink p-2 text-[11px] text-dim">{JSON.stringify(w.message, null, 2).slice(0, 3000)}</pre>}
                  </li>
                ))}
              </ol>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
