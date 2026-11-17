"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  ArrowUp,
  Mic,
  Home,
  Wrench,
  Clock,
  ScanLine,
  Map,
  Settings2,
  Check,
  Pause,
  Play,
  ShieldOff,
  ChevronRight,
} from "lucide-react";
const ForgeApplication = dynamic(() =>
  import("./forge-application").then((module) => module.ForgeApplication),
);
import { useVoiceInput } from "./use-voice-input";
import { connectSimulator } from "@/forge/browser-mcp";
import type { Program, ProgramRun } from "@/forge/product/contracts";
import type { GoalResult, ProductRuntime } from "@/forge/product/runtime";
type Snapshot = Awaited<ReturnType<ProductRuntime["snapshot"]>>;
type ProductContext = {
  snapshot?: Snapshot;
  error: string;
  token: string;
  refresh: () => Promise<void>;
  send: (command: Record<string, unknown>) => Promise<unknown>;
  setToken: (value: string) => void;
};
const Context = createContext<ProductContext | null>(null);
function useProduct() {
  const context = useContext(Context);
  if (!context) throw new Error("Product context required");
  return context;
}
const routes = [
  { href: "/", label: "Home", icon: Home },
  { href: "/tools", label: "Tools", icon: Wrench },
  { href: "/activity", label: "Activity", icon: Clock },
  { href: "/inspect", label: "Inspect", icon: ScanLine },
];
export function ForgeProductRoot({ children }: { children: ReactNode }) {
  const path = usePathname();
  const primary = routes.some((route) => route.href === path);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [settings, setSettings] = useState(false);
  const request = useCallback(
    async (command?: Record<string, unknown>) => {
      const response = await fetch("/api/product", {
        method: command ? "POST" : "GET",
        headers: {
          ...(command ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        ...(command ? { body: JSON.stringify(command) } : {}),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(value.error ?? "The request could not complete");
      return value;
    },
    [token],
  );
  const refresh = useCallback(async () => {
    try {
      setSnapshot(await request());
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load FORGE");
    }
  }, [request]);
  const send = useCallback(
    async (command: Record<string, unknown>) => {
      const value = await request(command);
      await refresh();
      return value;
    },
    [request, refresh],
  );
  useEffect(() => {
    if (!primary) return;
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [primary, refresh]);
  if (!primary)
    return (
      <div className="inspect-legacy">
        <div className="research-back">
          <Link href="/">← FORGE Home</Link>
          <span>
            {path === "/twin" || path === "/city"
              ? "Digital Twin · simulation"
              : "Inspect · legacy and research tools"}
          </span>
          <Link href="/inspect">Inspect</Link>
        </div>
        <ForgeApplication>{children}</ForgeApplication>
      </div>
    );
  return (
    <Context.Provider
      value={{ snapshot, error, token, refresh, send, setToken }}
    >
      <div className="product-shell">
        <aside className="product-nav">
          <Link className="product-brand" href="/">
            <span>F</span> FORGE
          </Link>
          <nav aria-label="Main navigation">
            {routes.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={path === href ? "selected" : ""}
              >
                <Icon size={18} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="product-nav-bottom">
            <Link href="/twin">
              <Map size={18} />
              Twin<span>Simulation</span>
            </Link>
            <button onClick={() => setSettings((value) => !value)}>
              <Settings2 size={18} />
              Connections & access
            </button>
            <p>
              Local models. Your files.
              <br />
              No paid services.
            </p>
          </div>
        </aside>
        <div className="product-workspace">
          <header className="product-top">
            <span>{routes.find((route) => route.href === path)?.label}</span>
            <div className="product-mode">
              <i
                className={
                  snapshot?.planner.ready &&
                  (snapshot.planner.mode !== "live" ||
                    snapshot.planner.requestCap > snapshot.planner.requestsUsed)
                    ? "online"
                    : ""
                }
              />
              {snapshot?.planner.label ?? "Connecting"}
              {snapshot?.planner.mode === "live" &&
              snapshot.planner.requestCap === 0
                ? " · request budget disabled"
                : ""}
            </div>
          </header>
          {error && (
            <div className="product-error" role="alert">
              {error}
              {error === "Authentication required" && (
                <button onClick={() => setSettings(true)}>
                  Enter access token
                </button>
              )}
            </div>
          )}
          {settings && (
            <section className="product-settings">
              <div>
                <h2>Your connections</h2>
                <button onClick={() => setSettings(false)}>Close</button>
              </div>
              <Connections />
              <label>
                Owner API token
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  autoComplete="off"
                  placeholder="Only needed if server authentication is enabled"
                />
              </label>
              <p>The token stays in this browser session’s memory.</p>
            </section>
          )}
          <main className="product-main">{children}</main>
        </div>
      </div>
    </Context.Provider>
  );
}
function Connections({ availableOnly = false }: { availableOnly?: boolean }) {
  const { snapshot } = useProduct();
  return (
    <div className="product-connections">
      {snapshot?.resources
        .filter(
          (resource) =>
            resource.id !== "twin" &&
            (!availableOnly || resource.status === "connected"),
        )
        .map((resource) => (
          <div key={resource.id}>
            <span
              className={
                resource.status === "connected"
                  ? "connection-dot connected"
                  : "connection-dot"
              }
            />
            <strong>{resource.name}</strong>
            <span>
              {resource.status === "connected"
                ? resource.mode === "test"
                  ? "Test connection"
                  : "Connected"
                : resource.status === "error"
                  ? "Needs attention"
                  : "Connect"}
            </span>
            {resource.status !== "connected" && resource.setup && (
              <Link href={resource.setup}>
                Set up <ChevronRight size={13} />
              </Link>
            )}
          </div>
        ))}
    </div>
  );
}
function PermissionNames({ permissions }: { permissions: string[] }) {
  const { snapshot } = useProduct();
  return (
    <ul className="permission-list">
      {permissions.map((permission) => (
        <li key={permission}>
          <Check size={15} />
          {snapshot?.resources
            .flatMap((resource) => resource.operations)
            .find((operation) => operation.permission === permission)?.name ??
            permission}
        </li>
      ))}
    </ul>
  );
}
function Review({
  tool,
  onRun,
}: {
  tool: Program;
  onRun: (id: string) => Promise<void>;
}) {
  const router = useRouter();
  const { send, snapshot } = useProduct();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [approved, setApproved] = useState(tool.status !== "review");
  async function approve() {
    setWorking(true);
    try {
      await send({
        action: "approve",
        id: tool.id,
        hash: tool.hash,
        permissions: tool.permissions,
      });
      setApproved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Approval failed");
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="product-review">
      <div className="review-title">
        <Check size={18} />
        <span>
          {approved ? "Ready to use" : "Checks passed. Review before running."}
        </span>
      </div>
      <h2>
        {tool.name}
        <small>v{tool.version}</small>
      </h2>
      <p>{tool.description}</p>
      <div className="replay-proof">
        <span>Read-only replay</span>
        <strong>{tool.evidence.replay.observations} records checked</strong>
        <strong>
          {tool.evidence.replay.proposedOperations} changes proposed
        </strong>
        <strong>0 external writes</strong>
        <small>
          {tool.connectors.includes("workspace")
            ? "Your uploaded files"
            : tool.evidence.replay.source === "test_connector"
              ? "Controlled test data"
              : tool.evidence.replay.source === "authorized_history"
                ? "Your authorized recent data"
                : "Simulation"}
        </small>
      </div>
      <h3>{approved ? "Approved access" : "Allow this tool to"}</h3>
      <PermissionNames permissions={tool.permissions} />
      <p className="product-muted">
        {tool.trigger.kind === "manual"
          ? "Runs when you ask."
          : "Runs locally every " +
            ("intervalSeconds" in tool.trigger
              ? tool.trigger.intervalSeconds + " seconds"
              : "authorized connector event") +
            " while FORGE is running."}
      </p>
      {error && <p role="alert">{error}</p>}
      {tool.actions.some((action) => action.startsWith("calendar.")) &&
        !snapshot?.resources.find((resource) => resource.id === "calendar")
          ?.constraints.calendarWritesConsented && (
          <p>
            Calendar editing needs Google consent.{" "}
            <Link href="/live">Connect Calendar editing</Link>, then recheck
            this tool against the current connection.
          </p>
        )}
      <div className="product-actions">
        {approved ? (
          <button
            className="product-primary"
            disabled={working}
            onClick={() => void onRun(tool.id)}
          >
            Run tool
          </button>
        ) : (
          <>
            <button
              className="product-primary"
              disabled={working}
              onClick={() => void approve()}
            >
              {working ? "Approving…" : "Approve exact access"}
            </button>
            <button
              disabled={working}
              onClick={() =>
                void send({
                  action: "reject",
                  id: tool.id,
                  hash: tool.hash,
                }).catch((error) =>
                  setError(
                    error instanceof Error ? error.message : "Rejection failed",
                  ),
                )
              }
            >
              Reject
            </button>
          </>
        )}
        <Link href={"/inspect?tool=" + tool.id}>Inspect evidence</Link>
        <button
          disabled={working}
          onClick={() =>
            void send({ action: "recheck", id: tool.id, hash: tool.hash })
              .then(() => router.push("/tools#" + tool.id))
              .catch((error) =>
                setError(
                  error instanceof Error ? error.message : "Recheck failed",
                ),
              )
          }
        >
          Recheck connection
        </button>
      </div>
    </section>
  );
}
function ResultReceipt({ run }: { run: ProgramRun }) {
  return (
    <section
      className={"product-receipt " + (run.status === "failed" ? "failed" : "")}
      role="status"
    >
      <small>
        {run.mode === "test"
          ? "TEST CONNECTOR RESULT"
          : run.mode === "simulation"
            ? "SIMULATION RESULT"
            : "RESULT"}
      </small>
      <h2>{run.summary}</h2>
      {run.verification && (
        <p>
          {run.verification.status === "verified"
            ? "Declared outcome checks passed."
            : run.verification.status === "failed"
              ? "The expected outcome could not be confirmed. Inspect the changes before retrying."
              : "Outcome not independently verified."}
        </p>
      )}
      {run.error && <p>{run.error}</p>}
      {run.details.map((detail, index) => (
        <p key={index}>{detail}</p>
      ))}
      {run.receipts
        .filter(
          (receipt) =>
            receipt.operation === "workspace.save" && receipt.responseId,
        )
        .map((receipt) => (
          <ArtifactDownload
            key={receipt.responseId}
            id={receipt.responseId!}
            name={receipt.target}
          />
        ))}
      <div>
        {run.receipts.map((receipt, index) => (
          <span key={index}>
            {receipt.operation} · {receipt.status}
          </span>
        ))}
      </div>
      <Link href="/activity">
        View activity <ChevronRight size={14} />
      </Link>
    </section>
  );
}
function ArtifactDownload({ id, name }: { id: string; name: string }) {
  const { token } = useProduct();
  const [error, setError] = useState("");
  async function download() {
    try {
      setError("");
      const response = await fetch(
        "/api/product?artifact=" + encodeURIComponent(id),
        { headers: token ? { Authorization: "Bearer " + token } : {} },
      );
      if (!response.ok) throw new Error("The output could not be downloaded");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Download failed");
    }
  }
  return (
    <div className="workspace-download">
      <button className="product-primary" onClick={() => void download()}>
        Download {name}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function WorkspaceFiles() {
  const { snapshot, send } = useProduct();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file: File) {
    setBusy(true);
    setError("");
    try {
      if (file.size > 16384)
        throw new Error("Choose a CSV, JSON or text file under 16 KiB.");
      const format = file.name.toLowerCase().endsWith(".csv")
        ? "csv"
        : file.name.toLowerCase().endsWith(".json")
          ? "json"
          : "text";
      await send({
        action: "upload",
        name: file.name,
        format,
        text: await file.text(),
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "The file could not be added",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-files" aria-label="Files for your tools">
      <div>
        <label className="workspace-upload">
          {busy ? "Adding file…" : "Add a file"}
          <input
            aria-label="Upload a file"
            type="file"
            accept=".csv,.json,.txt,.md"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </label>
        <span>CSV, JSON or text · stays on this computer</span>
      </div>
      {snapshot?.workspace.documents.length ? (
        <ul>
          {snapshot.workspace.documents.map((file) => (
            <li key={file.id}>
              <strong>{file.name}</strong>
              <span>{file.bytes.toLocaleString()} bytes</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          Give a tool real data to work with. Nothing is uploaded to a cloud
          service.
        </p>
      )}
      {error && (
        <p className="product-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
export function ForgeHome() {
  const { snapshot, token, send, refresh } = useProduct();
  const [goal, setGoal] = useState("");
  const [building, setBuilding] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [stages, setStages] = useState<string[]>([]);
  const [answer, setAnswer] = useState<GoalResult>();
  const [run, setRun] = useState<ProgramRun>();
  const [error, setError] = useState("");
  const voice = useVoiceInput(setGoal);
  const [failureKind, setFailureKind] = useState<"build" | "run">("build");
  async function runTool(id: string) {
    setError("");
    setFailureKind("run");
    try {
      setRun((await send({ action: "run", id })) as ProgramRun);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The run failed");
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!snapshot || building || voice.active || goal.trim().length < 5) return;
    setBuilding(true);
    setFailureKind("build");
    setElapsedSeconds(0);
    const startedAt = performance.now();
    setError("");
    setAnswer(undefined);
    setRun(undefined);
    setStages([]);
    const buildId = crypto.randomUUID();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((performance.now() - startedAt) / 1000));
      void fetch("/api/product?buildId=" + buildId, {
        headers: token ? { Authorization: "Bearer " + token } : {},
      })
        .then((response) => response.json())
        .then((value) => {
          if (value.progress)
            setStages(
              value.progress.stages.map(
                (stage: { name: string }) => stage.name,
              ),
            );
        })
        .catch(() => {});
    }, 750);
    let client: Awaited<ReturnType<typeof connectSimulator>> | undefined;
    try {
      client = await connectSimulator(token || undefined);
      const response = await client.callTool(
        {
          name: "forge.build",
          arguments: {
            request: goal,
            buildId,
            ...(new URLSearchParams(window.location.search).get("edit")
              ? {
                  followUpId: new URLSearchParams(window.location.search).get(
                    "edit",
                  ),
                }
              : {}),
          },
        },
        undefined,
        { timeout: 900000 },
      );
      if (response.isError)
        throw new Error(
          (response.content as { text?: string }[])[0]?.text ??
            "FORGE could not build this tool",
        );
      const result = JSON.parse(
        (response.content as { text: string }[])[0].text,
      ) as GoalResult;
      setAnswer(result);
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The request stopped before installation",
      );
    } finally {
      clearInterval(timer);
      await client?.close();
      setBuilding(false);
    }
  }
  return (
    <div className="product-home">
      <div className="product-intro">
        <span className="product-kicker">SOFTWARE FOR WHAT YOU NEED NEXT</span>
        <h1>
          What should your
          <br />
          next tool do?
        </h1>
        <p>
          Describe the result. FORGE writes and tests the missing software, then
          asks before it runs.
        </p>
      </div>
      <form className="product-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="forge-goal">
          Tell FORGE what you want
        </label>
        <textarea
          id="forge-goal"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Turn my orders file into a report of total sales by item."
          maxLength={4000}
          rows={3}
        />
        <div>
          <span>
            {building
              ? `Working on your request… ${elapsedSeconds}s`
              : "Use your own words."}
          </span>
          <button
            type="button"
            aria-label={
              voice.status === "idle" ? "Start voice input" : "Stop voice input"
            }
            disabled={building || voice.status === "stopping"}
            aria-pressed={voice.active}
            onClick={() => void voice.toggle(goal)}
            className={voice.status !== "idle" ? "listening" : ""}
          >
            <Mic size={19} />
          </button>
          <button
            className="product-send"
            type="submit"
            aria-label="Ask FORGE"
            disabled={
              !snapshot || building || voice.active || goal.trim().length < 5
            }
          >
            <ArrowUp size={21} />
          </button>
        </div>
      </form>
      <WorkspaceFiles />
      {voice.message && (
        <p className="product-muted" role="status">
          {voice.message}
        </p>
      )}
      {error && (
        <div className="product-error" role="alert">
          <p>
            {failureKind === "build"
              ? "FORGE could not build a working tool. Nothing was installed."
              : "The run could not finish. Inspect its changes before retrying."}
          </p>
          <details>
            <summary>Show details</summary>
            <p>{error}</p>
          </details>
        </div>
      )}
      {(building || stages.length > 0) && (
        <ol className="product-progress" aria-live="polite">
          {stages.map((stage, index) => (
            <li key={stage + index}>
              {index === stages.length - 1 && building ? (
                <span className="progress-spinner" />
              ) : (
                <Check size={13} />
              )}{" "}
              {stage}
            </li>
          ))}
        </ol>
      )}
      {answer && (
        <div className="product-answer">
          <p>{answer.explanation}</p>
          {answer.state === "offline" && (
            <Link href="/inspect">
              Planning setup & verified evidence <ChevronRight size={14} />
            </Link>
          )}
          {answer.missingConnections?.length ? (
            <p>Connection needed: {answer.missingConnections.join(", ")}</p>
          ) : null}
          {answer.tool && (
            <Review key={answer.tool.hash} tool={answer.tool} onRun={runTool} />
          )}
        </div>
      )}
      {run && <ResultReceipt run={run} />}
      {!answer && !building && (
        <>
          <section className="home-connections">
            <h2>Your connections</h2>
            <Connections availableOnly />
            <Link href="/inspect">
              Connection details <ChevronRight size={13} />
            </Link>
          </section>
          <section className="home-recent">
            <div>
              <h2>Recent tools</h2>
              <Link href="/tools">
                All tools <ChevronRight size={14} />
              </Link>
            </div>
            {snapshot?.programs
              .filter(
                (program) =>
                  program.installedAt && program.status !== "superseded",
              )
              .slice(-3)
              .reverse()
              .map((tool) => (
                <Link key={tool.hash} href={"/tools#" + tool.id}>
                  <Wrench size={17} />
                  <strong>{tool.name}</strong>
                  <span>{tool.status}</span>
                </Link>
              ))}
            {!snapshot?.programs.some((program) => program.installedAt) && (
              <p>Tools you approve will stay here, ready for next time.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
export function ForgeTools() {
  const { snapshot, send } = useProduct();
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProgramRun>();
  async function command(action: string, tool: Program) {
    try {
      setError("");
      const value = await send({
        action,
        id: tool.id,
        ...(action === "run" ? {} : { hash: tool.hash }),
      });
      if (action === "run") setResult(value as ProgramRun);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Tool action failed");
    }
  }
  const tools =
    snapshot?.programs.filter(
      (program) => !["superseded", "rejected"].includes(program.status),
    ) ?? [];
  return (
    <div>
      <div className="product-page-title">
        <span className="product-kicker">SOFTWARE THAT STAYS WITH YOU</span>
        <h1>Your tools</h1>
        <p>
          What FORGE has built, what is running, and the access you control.
        </p>
      </div>
      {error && (
        <p role="alert" className="product-error">
          {error}
        </p>
      )}
      {result && <ResultReceipt run={result} />}
      <div className="product-tool-list">
        {tools.map((tool) => (
          <article id={tool.id} key={tool.hash} className="product-tool">
            <div className="tool-heading">
              <Wrench size={21} />
              <h2>
                {tool.name}
                <small>v{tool.version}</small>
              </h2>
              <span className={"tool-status " + tool.status}>
                {tool.status}
              </span>
            </div>
            <p>{tool.description}</p>
            <p className="product-muted">
              {tool.trigger.kind === "manual"
                ? "On request"
                : "Local " + tool.trigger.kind + " monitor"}
              {tool.lastRunAt
                ? " · Last run " + new Date(tool.lastRunAt).toLocaleString()
                : ""}
            </p>
            <PermissionNames permissions={tool.permissions} />
            {tool.status === "review" ? (
              <Review
                tool={tool}
                onRun={async (id) => {
                  setResult((await send({ action: "run", id })) as ProgramRun);
                }}
              />
            ) : (
              <div className="product-actions">
                {tool.status === "ready" && (
                  <>
                    <button
                      className="product-primary"
                      onClick={() => void command("run", tool)}
                    >
                      <Play size={14} />
                      Run
                    </button>
                    <button onClick={() => void command("pause", tool)}>
                      <Pause size={14} />
                      Pause
                    </button>
                  </>
                )}
                {tool.status === "paused" && (
                  <button onClick={() => void command("resume", tool)}>
                    <Play size={14} />
                    Resume
                  </button>
                )}
                {tool.status !== "revoked" && (
                  <button onClick={() => void command("revoke", tool)}>
                    <ShieldOff size={14} />
                    Revoke access
                  </button>
                )}
                <Link href={"/?edit=" + tool.id}>Edit tool</Link>
                <Link href={"/inspect?tool=" + tool.id}>
                  Versions & evidence <ChevronRight size={14} />
                </Link>
              </div>
            )}
          </article>
        ))}
      </div>
      {!tools.length && (
        <div className="product-empty">
          <Wrench size={28} />
          <h2>Your next tool starts with a request.</h2>
          <p>Approved tools persist across refreshes and server restarts.</p>
          <Link href="/">
            Ask FORGE <ChevronRight size={15} />
          </Link>
        </div>
      )}
      <p className="legacy-link">
        Earlier capabilities and simulation releases remain available in{" "}
        <Link href="/capabilities">Inspect legacy tools</Link>.
      </p>
    </div>
  );
}
export function ForgeActivity() {
  const { snapshot } = useProduct();
  return (
    <div>
      <div className="product-page-title">
        <span className="product-kicker">A RECORD OF WHAT HAPPENED</span>
        <h1>Activity</h1>
        <p>Actual results, notifications, and stopped runs.</p>
      </div>
      <div className="product-timeline">
        {snapshot?.runs
          .slice()
          .reverse()
          .map((run) => (
            <article key={run.id}>
              <time>{new Date(run.at).toLocaleString()}</time>
              <div>
                <h2>
                  {snapshot.programs.find((tool) => tool.hash === run.hash)
                    ?.name ?? run.toolId}
                </h2>
                <p>{run.summary}</p>
                {run.error && <p className="activity-failure">{run.error}</p>}
                {run.details.map((detail, index) => (
                  <p className="product-muted" key={index}>
                    {detail}
                  </p>
                ))}
                <small>
                  {run.mode.toUpperCase()} · v{run.version} ·{" "}
                  {
                    run.receipts.filter(
                      (receipt) => receipt.status === "committed",
                    ).length
                  }{" "}
                  changes
                </small>
                {run.receipts
                  .filter(
                    (receipt) =>
                      receipt.operation === "workspace.save" &&
                      receipt.responseId,
                  )
                  .map((receipt) => (
                    <ArtifactDownload
                      key={receipt.responseId}
                      id={receipt.responseId!}
                      name={receipt.target}
                    />
                  ))}
              </div>
            </article>
          ))}
      </div>
      {!snapshot?.runs.length && (
        <div className="product-empty">
          <Clock size={28} />
          <h2>Your tools’ work will show up here.</h2>
          <p>
            Replay proposals and compilation never count as completed changes.
          </p>
        </div>
      )}
    </div>
  );
}
export function ForgeInspect() {
  const { snapshot, send } = useProduct();
  const [error, setError] = useState("");
  return (
    <div>
      <div className="product-page-title">
        <span className="product-kicker">WHY YOU CAN TRUST A TOOL</span>
        <h1>Inspect FORGE</h1>
        <p>Source, tests, access, versions, and actual provider evidence.</p>
      </div>
      <section className="product-inspect-summary">
        <h2>Interactive compiler</h2>
        <p>
          {snapshot?.planner.label} · {snapshot?.planner.mode} mode
        </p>
        <p>{snapshot?.planner.reason}</p>
        <p>
          Paid planning requests: {snapshot?.planner.requestsUsed ?? 0} /{" "}
          {snapshot?.planner.requestCap ?? 0}. Local model usage is recorded
          with each tool.
        </p>
        <p>
          Local generation uses cached model weights on this computer. Paid
          services and unknown external connector pricing are blocked by
          default. Historical Bedrock results belong to earlier experiments.
        </p>
        <Link href="/twin">Open FORGE Twin</Link>
        <Link href="/lab">Research & measurements</Link>
        <Link href="/studio">Program experiments</Link>
        <Link href="/live">Google consent & dedicated Calendar</Link>
        <Link href="/capabilities">Earlier capabilities</Link>
        <p>
          {snapshot?.executionLedger.plans ?? 0} /{" "}
          {snapshot?.executionLedger.capacity ?? 500} durable event plans ·{" "}
          {snapshot?.executionLedger.uncertainWrites ?? 0} writes awaiting
          inspection. Completed event IDs remain reserved; history capacity
          stops admission rather than risking duplicate changes.
        </p>
      </section>
      <details className="product-evidence">
        <summary>External connections</summary>
        <p>
          External API and MCP execution is disabled in free-only mode because a
          connected endpoint does not prove zero cost. Local files and installed
          tools remain available.
        </p>
        <ConnectorImport />
      </details>
      {error && <p role="alert">{error}</p>}
      {snapshot?.programs
        .slice()
        .reverse()
        .map((tool) => (
          <details className="product-evidence" key={tool.hash}>
            <summary>
              {tool.name} · v{tool.version}
              <span>{tool.status}</span>
            </summary>
            <div>
              <h3>Program</h3>
              <pre>{tool.source}</pre>
              <p className="source-hash">SHA-256 {tool.hash}</p>
              {!!tool.provenance.length && (
                <p>
                  Composed from{" "}
                  {tool.provenance
                    .map(
                      (parent) =>
                        `${parent.id} v${parent.version} (${parent.hash.slice(0, 12)})`,
                    )
                    .join(", ")}
                  . This version requires its own exact approval.
                </p>
              )}
              <h3>Tests & replay</h3>
              {tool.evidence.checks.map((check) => (
                <p key={check.name}>
                  {check.passed ? "✓" : "×"} {check.name}: {check.details}
                </p>
              ))}
              <p>
                {tool.evidence.replay.source} ·{" "}
                {tool.evidence.replay.observations} records ·{" "}
                {tool.evidence.replay.proposedOperations} proposed changes · 0
                external writes
              </p>
              <h3>Build</h3>
              <p>
                {tool.usage.provider} · {tool.usage.model ?? "no model"} ·{" "}
                {tool.usage.region ?? "local"} · {tool.usage.calls} live model
                requests · schema{" "}
                {tool.usage.schemaValidated ? "passed" : "failed"}
              </p>
              <p>
                Compile {tool.evidence.compileMs.toFixed(1)} ms · sandbox tests{" "}
                {tool.evidence.sandboxMs.toFixed(1)} ms · generation{" "}
                {tool.usage.durationMs.toFixed(1)} ms
              </p>
              <h3>Access</h3>
              <PermissionNames permissions={tool.permissions} />
              <p>Granted: {tool.grants.join(", ") || "none"}</p>
              <p>
                Trigger backend: local. Event and change detection run on
                bounded polling intervals.
              </p>
              {tool.installedAt && tool.status !== "revoked" && (
                <button
                  onClick={() =>
                    void send({
                      action: "rollback",
                      id: tool.id,
                      hash: tool.hash,
                    }).catch((error) =>
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Rollback failed",
                      ),
                    )
                  }
                >
                  Review this version for rollback
                </button>
              )}
            </div>
          </details>
        ))}
    </div>
  );
}
function ConnectorImport() {
  const { send } = useProduct();
  const [kind, setKind] = useState("openapi");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setResult("");
    try {
      const token = String(data.get("credential") ?? "");
      await send({
        action: "import",
        connection: {
          id: data.get("id"),
          name: data.get("name"),
          kind,
          baseUrl: data.get("url"),
          domains: String(data.get("domains"))
            .split(",")
            .map((value) => value.trim()),
          operationAllowlist: String(data.get("operations"))
            .split(",")
            .map((value) => value.trim()),
          readOperations: String(data.get("reads") ?? "")
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          ...(kind === "openapi" ? { spec: data.get("spec") } : {}),
          ...(token ? { credential: { kind: "bearer", token } } : {}),
        },
      });
      form.reset();
      setResult(
        "Connection imported. Operations are available for discovery; generated tools still require approval.",
      );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="product-evidence">
      <summary>Connect an OpenAPI or MCP service</summary>
      <form className="connector-import" onSubmit={submit}>
        <p>
          Choose exact public domains and operations. Secrets stay in the
          encrypted connector vault. Discovery grants no generated tool write
          access.
        </p>
        <label>
          Service type
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value)}
          >
            <option value="openapi">OpenAPI 3.0 / 3.1 JSON or YAML</option>
            <option value="mcp">MCP Streamable HTTP</option>
          </select>
        </label>
        <label>
          Connector ID
          <input
            name="id"
            required
            pattern="[a-z][a-z0-9_\-]{0,47}"
            placeholder="my_service"
          />
        </label>
        <label>
          Name
          <input name="name" required minLength={2} />
        </label>
        <label>
          HTTPS base URL
          <input
            name="url"
            type="url"
            required
            placeholder="https://api.example.com"
          />
        </label>
        <label>
          Allowed domains, comma-separated
          <input name="domains" required placeholder="api.example.com" />
        </label>
        <label>
          Allowed operation IDs, comma-separated
          <input name="operations" required />
        </label>
        {kind === "mcp" && (
          <label>
            Read-only tool names, explicitly verified by you
            <input name="reads" />
          </label>
        )}
        {kind === "openapi" && (
          <label>
            Specification
            <textarea name="spec" required rows={7} maxLength={60000} />
          </label>
        )}
        <label>
          Bearer token, if required
          <input name="credential" type="password" autoComplete="off" />
        </label>
        <button className="product-primary" disabled={busy}>
          {busy ? "Validating…" : "Validate & connect"}
        </button>
        <p role="status">{result}</p>
      </form>
    </details>
  );
}
