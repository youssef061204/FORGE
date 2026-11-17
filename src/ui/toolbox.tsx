"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Grant, Passport } from "@/core/contracts/passport";
import type { Example } from "@/core/events/types";
import type { Recipe } from "@/core/recipe/schema";
import type { Format } from "@/core/codec";
import { runInBrowser, type BrowserRun } from "./browser-runner";
import {
  Button,
  DataTable,
  EmptyState,
  Eyebrow,
  HoldSeal,
  Panel,
  cx,
} from "./primitives";
import { XRay } from "./xray";

type Version = {
  toolId: string;
  version: number;
  hash: string;
  recipe: Recipe;
  english: string[];
  passport: Passport;
  grants: Grant[];
  examples: Example[];
  status: string;
  approvedAt?: string;
  buildId?: string;
};
type Tool = {
  id: string;
  name: string;
  description: string;
  status: string;
  currentVersion?: number;
  updatedAt: string;
  lastRun?: { summary: string; at: string; status: string };
  version?: { english: string[]; passport: Passport };
};
type Run = {
  id: string;
  version: number;
  status: string;
  summary: string;
  error?: string;
  at: string;
  ms: number;
  trigger: string;
  inputs: { name: string }[];
};
type Receipt = {
  id: string;
  kind: string;
  target: string;
  detail: string;
  status: string;
  at: string;
  version: number;
  artifactId?: string;
};
type Detail = {
  tool: Tool;
  versions: Version[];
  runs: Run[];
  receipts: Receipt[];
  lastFiles: { id: string; name: string; format: string; bytes: number }[];
};

export function ToolboxList() {
  const [tools, setTools] = useState<Tool[]>();
  useEffect(() => {
    fetch("/api/tools")
      .then((r) => r.json())
      .then((d) => setTools(d.tools ?? []))
      .catch(() => setTools([]));
  }, []);
  return (
    <div className="mx-auto max-w-[1320px] px-4 py-10 sm:px-6">
      <h1 className="font-display text-4xl font-semibold">Toolbox</h1>
      <p className="mt-2 max-w-prose text-dim">
        Every tool you approved. Each one runs only inside its permissions, and
        every run leaves a receipt.
      </p>
      <div className="mt-8">
        {!tools ? (
          <div className="h-32 animate-pulse rounded-2xl bg-iron" />
        ) : tools.length === 0 ? (
          <EmptyState
            title="No tools yet"
            action={
              <Link href="/#build">
                <Button tone="molten">Forge your first tool</Button>
              </Link>
            }
          >
            Describe a result, FORGE builds and tests it, and after you approve
            it, it lands here.
          </EmptyState>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tools.map((t) => (
              <li key={t.id}>
                <Link href={`/tools/${t.id}`} className="block h-full">
                  <Panel
                    tone={t.status === "active" ? "steel" : "slag"}
                    className="h-full p-5 transition-colors hover:bg-iron"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-display text-xl font-semibold">
                        {t.name}
                      </h2>
                      <span
                        className={cx(
                          "shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em]",
                          t.status === "active"
                            ? "text-steel-hi"
                            : "text-[#f1a99b]",
                        )}
                      >
                        {t.status === "active"
                          ? `v${t.currentVersion}`
                          : t.status}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-[14px] text-dim">
                      {t.description}
                    </p>
                    {t.version && (
                      <ol className="mt-3 space-y-0.5 text-[12.5px] text-faint">
                        {t.version.english.slice(0, 3).map((l, i) => (
                          <li key={i} className="truncate">
                            {i + 1}. {l}
                          </li>
                        ))}
                      </ol>
                    )}
                    {t.lastRun && (
                      <p className="mt-3 text-[12px] text-dim">
                        Last run: {t.lastRun.summary}
                      </p>
                    )}
                  </Panel>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const TABS = [
  "Run",
  "X-ray",
  "Versions",
  "Access",
  "History",
  "Examples",
] as const;

export function ToolDetail({ id }: { id: string }) {
  const [d, setD] = useState<Detail>();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Run");
  const [err, setErr] = useState<string>();
  const load = useCallback(
    () =>
      fetch(`/api/tools/${id}`)
        .then((r) => r.json())
        .then((x) => (x.error ? setErr(x.error) : setD(x)))
        .catch((e) => setErr(e.message)),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (err)
    return <p className="mx-auto max-w-[1320px] p-6 text-[#f1a99b]">{err}</p>;
  if (!d)
    return (
      <div className="mx-auto mt-10 h-40 max-w-[1320px] animate-pulse rounded-2xl bg-iron" />
    );
  const current =
    d.versions.find((v) => v.version === d.tool.currentVersion) ??
    d.versions[0];
  return (
    <div className="mx-auto max-w-[1320px] px-4 py-8 sm:px-6">
      <Link href="/tools" className="text-[13px] text-dim hover:text-paper">
        ← Toolbox
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-semibold">{d.tool.name}</h1>
          <p className="mt-2 max-w-2xl text-dim">{d.tool.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {d.tool.status === "active" && (
            <a
              href={`/api/tools/${d.tool.id}/eject`}
              className="text-[13px] text-dim hover:text-paper"
              title="One JavaScript file with no dependencies: node tool.mjs <file>"
            >
              Download as a standalone file
            </a>
          )}
          <span
            className={cx(
              "rounded-full border px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.14em]",
              d.tool.status === "active"
                ? "border-steel/50 text-steel-hi"
                : "border-slag/60 text-[#f1a99b]",
            )}
          >
            {d.tool.status === "active"
              ? `Active · v${d.tool.currentVersion}`
              : d.tool.status}
          </span>
        </div>
      </div>
      <div
        role="tablist"
        className="mt-6 flex gap-1 overflow-x-auto border-b border-line"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-[14px] whitespace-nowrap",
              tab === t
                ? "border-amber text-paper"
                : "border-transparent text-dim hover:text-paper",
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "Run" && <RunTab d={d} onRan={load} />}
        {tab === "X-ray" && current && <XRayTab d={d} version={current} />}
        {tab === "Versions" && <VersionsTab d={d} />}
        {tab === "Access" && current && (
          <AccessTab d={d} version={current} onChange={load} />
        )}
        {tab === "History" && <HistoryTab d={d} />}
        {tab === "Examples" && <ExamplesTab d={d} />}
      </div>
    </div>
  );
}

function RunTab({ d, onRan }: { d: Detail; onRan: () => void }) {
  const v = d.versions.find((x) => x.version === d.tool.currentVersion);
  const [choice, setChoice] = useState<
    Record<string, { fileId?: string; inline?: { name: string; text: string } }>
  >(() =>
    Object.fromEntries(
      (v?.recipe.inputs ?? []).map((i, k) => [
        i.slot,
        d.lastFiles[k] ? { fileId: d.lastFiles[k].id } : {},
      ]),
    ),
  );
  const [out, setOut] = useState<{
    run: Run;
    receipts: Receipt[];
    artifacts: { id: string; name: string; preview: string; bytes: number }[];
    views: unknown[];
    deduplicated: boolean;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!v || d.tool.status !== "active")
    return (
      <EmptyState title="This tool can't run">
        It was {d.tool.status}. Approve a new version to use it again.
      </EmptyState>
    );
  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/tools/${d.tool.id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inputs: Object.entries(choice).map(([slot, c]) => ({ slot, ...c })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setOut(data);
      onRan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5">
      <Panel className="p-5">
        {v.recipe.inputs.map((i) => (
          <div key={i.slot} className="flex flex-wrap items-center gap-3 py-1">
            <span className="w-28 text-[14px] text-dim">{i.slot}</span>
            <select
              className="h-9 rounded-lg border border-line-strong bg-iron px-2 text-[14px]"
              value={
                choice[i.slot]?.fileId ??
                (choice[i.slot]?.inline ? "__inline" : "")
              }
              onChange={(e) =>
                setChoice({ ...choice, [i.slot]: { fileId: e.target.value } })
              }
              aria-label={`File for ${i.slot}`}
            >
              {d.lastFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
              {choice[i.slot]?.inline && (
                <option value="__inline">{choice[i.slot].inline!.name}</option>
              )}
            </select>
            <label className="cursor-pointer text-[13px] text-amber hover:underline">
              use another file…
              <input
                type="file"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    setChoice({
                      ...choice,
                      [i.slot]: {
                        inline: { name: f.name, text: await f.text() },
                      },
                    });
                }}
              />
            </label>
          </div>
        ))}
        <div className="mt-4 flex items-center gap-3">
          <Button tone="molten" onClick={run} disabled={busy}>
            {busy ? "Running…" : "Run"}
          </Button>
          <span className="text-[13px] text-faint">
            Runs in the sandbox. The broker checks each output against the
            approved permissions.
          </span>
        </div>
        {error && (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-slag-deep/60 px-3 py-2 text-[14px] text-[#f1a99b]"
          >
            Refused: {error}
          </p>
        )}
      </Panel>
      {out && (
        <Panel tone="steel" className="p-5">
          <Eyebrow>
            {out.deduplicated ? "Already handled" : "Run finished"}
          </Eyebrow>
          <p className="mt-1 font-display text-xl">{out.run.summary}</p>
          <p className="num mt-1 text-[12px] text-faint">
            {out.run.ms.toFixed(0)} ms in the sandbox
          </p>
          <ul className="mt-4 grid gap-3">
            {out.artifacts.map((a) => (
              <li key={a.id}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[13px]">{a.name}</span>
                  <a
                    href={`/api/artifacts/${a.id}`}
                    className="text-[13px] text-amber hover:underline"
                  >
                    Download
                  </a>
                </div>
                <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-ink p-3 font-mono text-[12px] text-paper/80">
                  {a.preview}
                </pre>
              </li>
            ))}
          </ul>
          <Receipts receipts={out.receipts} />
        </Panel>
      )}
    </div>
  );
}

function Receipts({ receipts }: { receipts: Receipt[] }) {
  if (!receipts.length) return null;
  return (
    <ul className="mt-4 space-y-1 text-[13px]">
      {receipts.map((r) => (
        <li
          key={r.id}
          className={cx(
            r.status === "denied"
              ? "text-[#f1a99b]"
              : r.status === "committed"
                ? "text-steel-hi"
                : "text-dim",
          )}
        >
          <span className="num text-faint">
            {new Date(r.at).toLocaleTimeString()}
          </span>{" "}
          {r.status === "denied" ? "refused" : r.status} · {r.kind} {r.target}{" "}
          <span className="text-faint">· {r.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function XRayTab({ d, version }: { d: Detail; version: Version }) {
  const [run, setRun] = useState<BrowserRun>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    Promise.all(
      d.lastFiles.map((f) => fetch(`/api/files/${f.id}`).then((r) => r.json())),
    )
      .then((files) =>
        runInBrowser(
          version.recipe,
          version.recipe.inputs.map((i, k) => ({
            slot: i.slot,
            name: files[k]?.file.name,
            format: files[k]?.file.format as Format,
            text: files[k]?.file.text ?? "",
          })),
        ),
      )
      .then((r) => alive && setRun(r))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [d.lastFiles, version]);
  if (error) return <p className="text-[#f1a99b]">{error}</p>;
  if (!run) return <div className="h-60 animate-pulse rounded-2xl bg-iron" />;
  return (
    <div className="grid gap-3">
      <p className="text-[14px] text-dim">
        Replayed in your browser on the last file this tool used. Nothing is
        written.
      </p>
      <XRay recipe={version.recipe} run={run} />
    </div>
  );
}

function lineDiff(a: string[], b: string[]) {
  const out: { kind: "same" | "add" | "del"; text: string }[] = [];
  const setA = new Set(a);
  const setB = new Set(b);
  for (const l of a) out.push({ kind: setB.has(l) ? "same" : "del", text: l });
  for (const l of b) if (!setA.has(l)) out.push({ kind: "add", text: l });
  return out;
}

function VersionsTab({ d }: { d: Detail }) {
  const [behavior, setBehavior] = useState<string>();
  const [pair, setPair] = useState<[number, number] | undefined>(
    d.versions.length > 1
      ? [d.versions[1].version, d.versions[0].version]
      : undefined,
  );
  const older = d.versions.find((v) => v.version === pair?.[0]);
  const newer = d.versions.find((v) => v.version === pair?.[1]);
  const diff = useMemo(
    () => (older && newer ? lineDiff(older.english, newer.english) : []),
    [older, newer],
  );
  useEffect(() => {
    if (!older || !newer || !d.lastFiles.length) return;
    let alive = true;
    Promise.all(
      d.lastFiles.map((f) => fetch(`/api/files/${f.id}`).then((r) => r.json())),
    )
      .then(async (files) => {
        const mk = (v: Version) =>
          v.recipe.inputs.map((i, k) => ({
            slot: i.slot,
            name: files[k]?.file.name,
            format: files[k]?.file.format as Format,
            text: files[k]?.file.text ?? "",
          }));
        const [a, b] = await Promise.all([
          runInBrowser(older.recipe, mk(older), false),
          runInBrowser(newer.recipe, mk(newer), false),
        ]);
        const ra = new Set(
          (a.outputs[0]?.table.rows ?? []).map((r) => JSON.stringify(r)),
        );
        const rb = (b.outputs[0]?.table.rows ?? []).map((r) =>
          JSON.stringify(r),
        );
        const changed =
          rb.filter((r) => !ra.has(r)).length +
          [...ra].filter((r) => !rb.includes(r)).length;
        if (alive)
          setBehavior(
            `On ${d.lastFiles[0].name}: ${changed} row${changed === 1 ? "" : "s"} change (${a.outputs[0]?.table.total ?? 0} → ${b.outputs[0]?.table.total ?? 0} rows).`,
          );
      })
      .catch((e) => alive && setBehavior(`Could not compare: ${e.message}`));
    return () => {
      alive = false;
    };
  }, [older, newer, d.lastFiles]);
  return (
    <div className="grid gap-4">
      <ol className="grid gap-2">
        {d.versions.map((v) => (
          <li key={v.version}>
            <Panel
              tone={v.status === "approved" ? "steel" : undefined}
              className="flex flex-wrap items-center gap-4 p-4"
            >
              <span className="font-display text-xl font-semibold">
                v{v.version}
              </span>
              <span
                className={cx(
                  "text-[12px] uppercase tracking-[0.14em]",
                  v.status === "approved"
                    ? "text-steel-hi"
                    : v.status === "revoked"
                      ? "text-[#f1a99b]"
                      : "text-faint",
                )}
              >
                {v.status}
              </span>
              <span className="num text-[12px] text-faint" title={v.hash}>
                {v.hash.slice(0, 12)}…
              </span>
              <span className="text-[12px] text-faint">
                {v.approvedAt ? new Date(v.approvedAt).toLocaleString() : ""}
              </span>
            </Panel>
          </li>
        ))}
      </ol>
      {older && newer ? (
        <Panel className="p-5">
          <Eyebrow>
            v{older.version} → v{newer.version}
          </Eyebrow>
          <ul className="mt-3 space-y-1 text-[14px]">
            {diff.map((l, i) => (
              <li
                key={i}
                className={cx(
                  l.kind === "add"
                    ? "text-amber"
                    : l.kind === "del"
                      ? "text-faint line-through"
                      : "text-dim",
                )}
              >
                {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}
                {l.text}
              </li>
            ))}
          </ul>
          {behavior && (
            <p className="mt-4 text-[14px] text-steel-hi">{behavior}</p>
          )}
          {newer.passport.delta && (
            <div className="mt-4 text-[14px]">
              <Eyebrow>Permission change</Eyebrow>
              {newer.passport.delta.added.map((x) => (
                <p key={x} className="text-amber">
                  + {x}
                </p>
              ))}
              {newer.passport.delta.removed.map((x) => (
                <p key={x} className="text-dim">
                  − {x}
                </p>
              ))}
              {!newer.passport.delta.added.length &&
                !newer.passport.delta.removed.length && (
                  <p className="text-dim">None.</p>
                )}
            </div>
          )}
          {d.versions.length > 2 && (
            <select
              className="mt-4 h-9 rounded-lg border border-line-strong bg-iron px-2 text-[13px]"
              onChange={(e) => setPair(JSON.parse(e.target.value))}
            >
              {d.versions.slice(1).map((v, i) => (
                <option
                  key={v.version}
                  value={JSON.stringify([v.version, d.versions[i].version])}
                >
                  v{v.version} → v{d.versions[i].version}
                </option>
              ))}
            </select>
          )}
        </Panel>
      ) : (
        <p className="text-[14px] text-dim">
          One version so far. Ask FORGE to change this tool (“update{" "}
          {d.tool.name} to …”) to make a new one; it will need its own approval.
        </p>
      )}
    </div>
  );
}

function AccessTab({
  d,
  version,
  onChange,
}: {
  d: Detail;
  version: Version;
  onChange: () => void;
}) {
  const [error, setError] = useState<string>();
  const revoke = async () => {
    const res = await fetch(`/api/tools/${d.tool.id}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (!res.ok) setError((await res.json()).error);
    onChange();
  };
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel tone="brass" className="p-5">
        <Eyebrow className="text-brass-hi">
          Permission passport · v{version.version}
        </Eyebrow>
        <ul className="mt-3 space-y-2">
          {version.passport.can.map((c, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className="mt-1.5 size-2 rounded-sm bg-brass" />
              {c.text}
            </li>
          ))}
        </ul>
        <ul className="mt-4 space-y-1 text-dim">
          {version.passport.cannot.map((c) => (
            <li key={c}>✕ {c}</li>
          ))}
        </ul>
      </Panel>
      <Panel tone="slag" className="p-5">
        <Eyebrow className="text-[#f1a99b]">Revoke</Eyebrow>
        <p className="mt-2 text-dim">
          Revoking removes every permission at once. Assistants see the tool
          disappear from their list, and any further call is refused with a
          receipt.
        </p>
        <div className="mt-4">
          {d.tool.status === "active" ? (
            <HoldSeal label="Hold to revoke" onSealed={revoke} />
          ) : (
            <p className="text-[#f1a99b]">Revoked.</p>
          )}
        </div>
        {error && <p className="mt-2 text-[#f1a99b]">{error}</p>}
      </Panel>
    </div>
  );
}

function HistoryTab({ d }: { d: Detail }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <Eyebrow className="mb-2">Runs</Eyebrow>
        {d.runs.length ? (
          <DataTable
            columns={["when", "version", "status", "summary", "ms"]}
            rows={d.runs.map((r) => ({
              when: new Date(r.at).toLocaleString(),
              version: `v${r.version}`,
              status: r.status,
              summary: r.error ?? r.summary,
              ms: Math.round(r.ms),
            }))}
            maxRows={20}
            dense
          />
        ) : (
          <p className="text-dim">No runs yet.</p>
        )}
      </div>
      <div>
        <Eyebrow className="mb-2">Receipts</Eyebrow>
        <Receipts receipts={d.receipts} />
      </div>
    </div>
  );
}

function ExamplesTab({ d }: { d: Detail }) {
  const examples = d.versions[0]?.examples ?? [];
  if (!examples.length)
    return (
      <EmptyState title="No confirmed examples">
        When you answer “which did you mean?” or fix a preview by hand, the
        example is stored here and every new version must reproduce it.
      </EmptyState>
    );
  return (
    <ul className="grid gap-4">
      {examples.map((e) => (
        <li key={e.id}>
          <Panel className="p-4">
            <Eyebrow>{e.note}</Eyebrow>
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-ink p-3 font-mono text-[12px]">
              {JSON.stringify(e.expected, null, 2)}
            </pre>
          </Panel>
        </li>
      ))}
    </ul>
  );
}
