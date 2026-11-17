"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import {
  ArrowUpRight,
  ArrowUp,
  AudioLines,
  Boxes,
  ChevronRight,
  CircleHelp,
  Code2,
  Command,
  Flame,
  GitBranch,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Mic,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Volume2,
  X,
} from "lucide-react";
import { connectSimulator, negotiatedProtocol } from "@/forge/browser-mcp";
import {
  stateSchema,
  releaseSchema,
  executionSchema,
  buildProgressSchema,
  type BuildProgress,
  type Release,
  type Execution,
  type State,
} from "@/forge/records";
import { extensionRequest, postings, scoutRequest } from "@/forge/fixtures";
import { CapabilityReview, permissionLabels, type ReviewTab } from "./review";
import { useVoiceInput } from "./use-voice-input";
import { useOptionalForgeApplication } from "./forge-application";

type Snapshot = State & {
  metrics: {
    executionCount: number;
    successRate: number | null;
    failures: number;
    p95LatencyMs: number | null;
    estimatedCost: number;
    permissionDenials: number;
    repairs: number;
    tokens: number;
  };
};
type Tool = { name: string; description?: string };
type Message = { role: "user" | "forge"; text: string };
const tabs: ReviewTab[] = [
  "Workflow",
  "Tests",
  "Permissions",
  "ForgeSpec",
  "Trace",
];
const householdRequest =
  "Summarize school updates daily and notify me with a family briefing.";
const initialMessage: Message = {
  role: "forge",
  text: "What can I help you build? Give me a goal. I’ll test the new tool and ask for your approval before installing it.",
};

export function ForgeStudio() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [tools, setTools] = useState<Tool[]>([]);
  const [beforeTools, setBeforeTools] = useState<Tool[]>();
  const [selected, setSelected] = useState<Release>();
  const [execution, setExecution] = useState<Execution>();
  const [tab, setTab] = useState<ReviewTab>("Workflow");
  const [view, setView] = useState("Studio");
  const [request, setRequest] = useState("");
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [busy, setBusy] = useState("");
  const [buildId, setBuildId] = useState<string>();
  const [progress, setProgress] = useState<BuildProgress>();
  const [runtimeInfo, setRuntimeInfo] = useState<{
    runtimeMode: "fixture" | "aws";
    compilerProvider: string;
    modelId: string;
  }>();
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [protocolVersion, setProtocolVersion] = useState<string>();
  const [protocol, setProtocol] = useState<string[]>([]);
  const [fixture, setFixture] = useState<keyof typeof postings>("amd");
  const application = useOptionalForgeApplication();
  const [localToken, setLocalToken] = useState("");
  const token = application?.token ?? localToken;
  const setToken = application?.setToken ?? setLocalToken;
  const [showToken, setShowToken] = useState(false);
  const voice = useVoiceInput(setRequest);
  const client = useRef<Client | null>(null);
  const record = (event: string) =>
    setProtocol((previous) => [event, ...previous].slice(0, 12));
  const addMessage = (message: Message) =>
    setMessages((previous) => [...previous, message]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((value) => {
        if (!controller.signal.aborted)
          setRuntimeInfo(
            z
              .object({
                runtimeMode: z.enum(["fixture", "aws"]),
                compilerProvider: z.string(),
                modelId: z.string(),
              })
              .parse(value),
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!buildId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/forge?buildId=${buildId}`, {
          cache: "no-store",
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const parsed = buildProgressSchema.safeParse(await response.json());
        if (!controller.signal.aborted && response.ok && parsed.success)
          setProgress(parsed.data);
      } catch {
        /* The MCP result remains authoritative if progress polling fails. */
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 250);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [buildId, token]);

  async function loadState(authToken = token) {
    const response = await fetch("/api/forge", {
      cache: "no-store",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    const value: unknown = await response.json();
    if (!response.ok)
      throw new Error(z.object({ error: z.string() }).parse(value).error);
    const parsed = stateSchema.parse(value);
    const metrics = z
      .object({
        metrics: z.object({
          executionCount: z.number(),
          successRate: z.number().nullable(),
          failures: z.number(),
          p95LatencyMs: z.number().nullable(),
          estimatedCost: z.number(),
          permissionDenials: z.number(),
          repairs: z.number(),
          tokens: z.number(),
        }),
      })
      .parse(value).metrics;
    const state = { ...parsed, metrics };
    setSnapshot(state);
    return state;
  }
  async function discover(active = client.current) {
    if (!active) throw new Error("Connect to the MCP server first.");
    const result = await active.listTools();
    setProtocolVersion(negotiatedProtocol(active));
    setTools(result.tools);
    setBeforeTools((previous) => previous ?? result.tools);
    record(`tools/list → ${result.tools.length} tools discovered`);
    return result.tools;
  }
  useEffect(() => {
    let disposed = false;
    let active: Client | undefined;
    (async () => {
      try {
        active = await connectSimulator(undefined, "fixture");
        if (disposed) {
          await active.close();
          return;
        }
        client.current = active;
        setConnected(true);
        const [state, listed] = await Promise.all([
          fetch("/api/forge").then(async (response) => {
            if (!response.ok)
              throw new Error("Server access requires an API token.");
            return stateSchema.parse(await response.json());
          }),
          active.listTools(),
        ]);
        if (!disposed) {
          setProtocolVersion(negotiatedProtocol(active));
          setTools(listed.tools);
          setBeforeTools(listed.tools);
          setSelected(state.releases.at(-1));
          setProtocol([
            `tools/list → ${listed.tools.length} tools discovered`,
            "MCP initialize → connected",
          ]);
          await loadState();
        }
      } catch (e) {
        if (!disposed)
          setError(e instanceof Error ? e.message : "Connection failed");
      }
    })();
    return () => {
      disposed = true;
      if (client.current === active) client.current = null;
      void active?.close();
    };
    // Connection initialization runs once. Token changes use the explicit reconnect action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function reconnect() {
    try {
      setBusy("Connecting");
      setError("");
      await client.current?.close();
      client.current = await connectSimulator(token, "fixture");
      setConnected(true);
      await Promise.all([loadState(), discover()]);
      setShowToken(false);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy("");
    }
  }
  async function mutate(body: Record<string, unknown>) {
    const response = await fetch("/api/forge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const value = z
      .record(z.string(), z.unknown())
      .parse(await response.json());
    if (!response.ok) throw new Error(z.string().parse(value.error));
    await loadState();
    if (typeof value.warning === "string") setError(value.warning);
    return value.result;
  }
  async function build(event?: FormEvent) {
    event?.preventDefault();
    if (!request.trim() || busy || voice.active) return;
    const goal = request.trim();
    const id = crypto.randomUUID();
    setProgress(undefined);
    setBuildId(id);
    setRequest("");
    setBusy("Compiling and executing validation");
    setError("");
    addMessage({ role: "user", text: goal });
    try {
      if (!client.current)
        throw new Error("MCP connection unavailable. Reconnect to continue.");
      setBeforeTools(await discover());
      record("tools/call → forge.build");
      const result = await client.current.callTool(
        { name: "forge.build", arguments: { request: goal, buildId: id } },
        undefined,
        { timeout: 120000 },
      );
      const block = z
        .array(
          z
            .object({ type: z.string(), text: z.string().optional() })
            .passthrough(),
        )
        .parse(result.content)
        .find((c) => c.type === "text");
      if (result.isError) throw new Error(block?.text ?? "Build failed");
      const release = releaseSchema.parse(JSON.parse(block?.text ?? "{}"));
      setSelected(release);
      try {
        const progressResponse = await fetch(`/api/forge?buildId=${id}`, {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const completed = buildProgressSchema.safeParse(
          await progressResponse.json(),
        );
        if (completed.success) setProgress(completed.data);
      } catch {
        /* Optional progress must not turn a completed MCP build into a failure. */
      }
      setExecution(undefined);
      setTab("Workflow");
      setView("Studio");
      await loadState();
      record(
        `forge.build → ${release.status}; ${release.report.checks.filter((c) => c.passed).length}/${release.report.checks.length} checks passed`,
      );
      addMessage({
        role: "forge",
        text:
          release.status === "installed"
            ? `I already have ${release.definition.name}. It is installed and available through MCP.`
            : release.status === "blocked"
              ? "Validation found a failure. Installation is blocked; inspect the check evidence."
              : `I’ve ${release.resolution === "EXTEND" ? "extended" : "compiled"} ${release.definition.name} ${release.definition.version}. The checks passed. Review its permissions, then approve to add ${release.definition.toolContract.name} to my MCP toolset.`,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Build failed";
      setError(message);
      addMessage({ role: "forge", text: message });
    } finally {
      setBuildId(undefined);
      setBusy("");
    }
  }
  async function approve() {
    if (!selected) return;
    setBusy("Installing approved MCP tool");
    setError("");
    try {
      const release = releaseSchema.parse(
        await mutate({
          action: "approve",
          id: selected.definition.id,
          version: selected.definition.version,
          digest: selected.digest,
        }),
      );
      setSelected(release);
      record(
        `Human approved → ${release.definition.toolContract.name} ${release.definition.version}`,
      );
      await discover();
      addMessage({
        role: "forge",
        text: `${release.definition.toolContract.name} is installed. I queried tools/list and discovered it. You can now invoke the new tool through MCP.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Installation failed");
    } finally {
      setBusy("");
    }
  }
  async function reject() {
    if (!selected) return;
    setBusy("Rejecting proposal");
    setError("");
    try {
      const release = releaseSchema.parse(
        await mutate({
          action: "reject",
          id: selected.definition.id,
          version: selected.definition.version,
          digest: selected.digest,
        }),
      );
      setSelected(release);
      await discover();
      addMessage({
        role: "forge",
        text: `${release.definition.name} was rejected. This proposal has not been installed.`,
      });
      record(
        `Human rejected → ${release.definition.toolContract.name} ${release.definition.version}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rejection failed");
    } finally {
      setBusy("");
    }
  }
  async function invoke() {
    if (!selected || !client.current) return;
    setBusy("Invoking through MCP");
    setError("");
    try {
      const cap = selected.definition;
      const args =
        cap.trigger === "new_job_posting"
          ? {
              eventId: `demo-${fixture}-${crypto.randomUUID()}`,
              jobPosting: postings[fixture],
            }
          : {
              eventId: `briefing-${crypto.randomUUID()}`,
              text: "School update: science projects are due Friday. The family picnic is on Saturday at 10am. Please bring a reusable water bottle.",
            };
      record(`tools/call → ${cap.toolContract.name}`);
      const result = await client.current.callTool(
        { name: cap.toolContract.name, arguments: args },
        undefined,
        { timeout: 60000 },
      );
      const run = executionSchema.parse(result.structuredContent);
      setExecution(run);
      setTab("Trace");
      await loadState();
      record(
        `${cap.toolContract.name} → ${run.status}; ${run.trace.length} trace steps`,
      );
      const match = z
        .object({ matchScore: z.number() })
        .safeParse(
          Object.values(run.outcome).find(
            (value) =>
              z.object({ matchScore: z.number() }).safeParse(value).success,
          ),
        );
      addMessage({
        role: "forge",
        text:
          run.status === "failed"
            ? `Execution stopped safely: ${run.error}`
            : match.success
              ? `The fixture posting has a ${match.data.matchScore}% structured skills match. ${run.trace.some((t) => t.operation === "notification.send" && t.status === "success") ? "A notification was saved in the simulator." : "The threshold was not met, so no notification was sent."}${run.trace.some((t) => t.operation === "document.write" && t.status === "success") ? " A tailored cover letter was saved too." : ""}`
              : `Your briefing was created.${run.trace.some((t) => t.operation === "notification.send" && t.status === "success") ? " A notification was saved." : ""} Inspect the trace for each brokered step.`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invocation failed");
    } finally {
      setBusy("");
    }
  }
  async function rollback(release: Release) {
    setBusy("Restoring approved version");
    setError("");
    try {
      setSelected(
        releaseSchema.parse(
          await mutate({
            action: "rollback",
            id: release.definition.id,
            version: release.definition.version,
          }),
        ),
      );
      await discover();
      record(`Rollback → ${release.definition.version}`);
      setView("Studio");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollback failed");
    } finally {
      setBusy("");
    }
  }
  const active =
    (selected &&
      snapshot?.releases.find((r) => r.digest === selected.digest)) ||
    selected;
  const lastReply =
    [...messages].reverse().find((m) => m.role === "forge")?.text ?? "";
  const installedCount =
    snapshot?.releases.filter((r) => r.status === "installed").length ?? 0;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="FORGE home">
          <div className="brand-mark">
            <Flame size={25} fill="currentColor" />
          </div>
          FORGE<span className="brand-beta">BETA</span>
        </Link>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          <Link
            className="nav-item"
            href="/world"
            onClick={() => voice.cancel()}
          >
            <Sparkles size={17} />
            FORGE World
            <ArrowUpRight size={13} />
          </Link>
          <Link
            className="nav-item"
            href="/live"
            onClick={() => voice.cancel()}
          >
            <ShieldCheck size={17} /> FORGE Live <ArrowUpRight size={13} />
          </Link>
          {[
            { name: "Studio", icon: Command },
            { name: "Capabilities", icon: Boxes },
            { name: "Executions", icon: Radio },
            { name: "Architecture", icon: Layers3 },
          ].map((item) => (
            <button
              key={item.name}
              className={view === item.name ? "nav-item active" : "nav-item"}
              onClick={() => {
                voice.cancel();
                setView(item.name);
              }}
            >
              <item.icon size={17} />
              {item.name}
              {item.name === "Capabilities" && <span>{installedCount}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="tiny-orbit">
            <Sparkles size={17} />
          </div>
          <strong>Goals become tools.</strong>
          <p>
            Tested. Permission-scoped.
            <br />
            Always yours to approve.
          </p>
        </div>
        <div className="sidebar-bottom">
          <div>
            <span className="live-dot" /> Local demo environment
          </div>
          <button onClick={() => setShowToken(!showToken)}>
            <LockKeyhole size={14} /> Connection settings
          </button>
          <a
            href="https://amazonappdev2026.devpost.com/details/faqs"
            target="_blank"
            rel="noreferrer"
          >
            <CircleHelp size={14} /> Hackathon guidance{" "}
            <ArrowUpRight size={13} />
          </a>
          <div className="profile">
            <div>AM</div>
            <span>
              Alex Morgan<small>Builder workspace</small>
            </span>
            <ChevronRight size={14} />
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span>Workspace</span>
            <ChevronRight size={12} />
            <strong>{view}</strong>
          </div>
          <div className="topbar-right">
            <span className="demo-badge">FIXTURE DATA</span>
            <span className="connection">
              <span className={connected ? "live-dot" : "live-dot offline"} />{" "}
              {connected ? "MCP connected" : "Disconnected"}
            </span>
            <button
              title="Refresh tool discovery"
              aria-label="Refresh tool discovery"
              disabled={!!busy}
              onClick={() => {
                void discover().catch((e) => setError(String(e)));
                void loadState().catch((e) => setError(String(e)));
              }}
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </header>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="amber-line" /> LEGACY FIXTURE WORKBENCH
              </div>
              <h1>
                {view === "Studio"
                  ? "Inspect the reproducible fixture compiler."
                  : view}
              </h1>
              <p>
                {view === "Studio"
                  ? "Explicit fixture scenarios for protocol and safety testing. Use Home for resource-driven requests."
                  : "Every tool, release, and execution comes from the same trusted runtime."}
              </p>
            </div>
            <div className="heading-stamp">
              <GitBranch size={15} />
              <span>
                FORGESPEC<small>v1.0 runtime</small>
              </span>
            </div>
          </div>
          {runtimeInfo && (
            <div className="runtime-info" data-testid="runtime-info">
              <span>Compiler: {runtimeInfo.compilerProvider}</span>
              <code>{runtimeInfo.modelId}</code>
              <small>
                Mode: {runtimeInfo.runtimeMode} · external data: labeled
                fixtures · independent simulator
              </small>
            </div>
          )}
          {showToken && (
            <form
              className="connection-form"
              onSubmit={(e) => {
                e.preventDefault();
                void reconnect();
              }}
            >
              <label>
                Server API token
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Only required for authenticated servers"
                  autoComplete="off"
                />
              </label>
              <button className="primary-button" disabled={!!busy}>
                Reconnect
              </button>
              <small>
                Kept in this tab’s memory. Never stored in browser storage.
              </small>
            </form>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {view === "Studio" && (
            <div className="studio-grid">
              <section className="conversation panel">
                <div className="panel-header">
                  <div>
                    <AudioLines size={17} />
                    <strong>Alexa+-style Agent Simulator</strong>
                  </div>
                  <span className="subtle-pill">VOICE + TEXT</span>
                </div>
                <div className="conversation-intro">
                  <div className="assistant-orbit">
                    <Flame size={23} />
                  </div>
                  <h2>
                    What should I be
                    <br />
                    able to do next?
                  </h2>
                  <p>
                    A new goal. A new program.
                    <br />A real tool in the MCP registry.
                  </p>
                </div>
                <div className="chat-log" aria-live="polite">
                  {messages.map((message, i) => (
                    <div key={i} className={`message ${message.role}`}>
                      <span>{message.role === "forge" ? "FORGE" : "YOU"}</span>
                      <p>{message.text}</p>
                    </div>
                  ))}
                  {busy && (
                    <div className="working">
                      <LoaderCircle size={14} className="spin" />
                      {busy}
                    </div>
                  )}
                  {progress && (
                    <details
                      className="build-progress"
                      open={!!buildId}
                      data-testid="build-progress"
                    >
                      <summary>
                        {progress.stages.at(-1)?.name ?? "Waiting for server"}
                      </summary>
                      <ol>
                        {progress.stages.map((stage, i) => (
                          <li key={`${stage.name}-${i}`}>
                            <span>{stage.name}</span>
                            <small>
                              {stage.durationMs === undefined
                                ? "In progress"
                                : `${stage.durationMs} ms`}
                            </small>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                </div>
                <div className="conversation-actions">
                  <button
                    onClick={() => {
                      if ("speechSynthesis" in window)
                        window.speechSynthesis.speak(
                          new SpeechSynthesisUtterance(lastReply),
                        );
                      else
                        setError(
                          "Speech synthesis is unavailable in this browser.",
                        );
                    }}
                    title="Read reply aloud"
                    aria-label="Read reply aloud"
                    disabled={voice.active}
                  >
                    <Volume2 size={14} />
                  </button>
                  <span>YOUR NEXT CAPABILITY</span>
                </div>
                <form className="composer" onSubmit={build}>
                  <textarea
                    aria-label="Program request"
                    placeholder="Alexa, whenever a new internship appears…"
                    value={request}
                    onChange={(e) => setRequest(e.target.value)}
                    maxLength={4000}
                    disabled={!!busy || voice.active}
                  />
                  <div>
                    <button
                      type="button"
                      className={voice.active ? "mic listening" : "mic"}
                      aria-label={
                        voice.active ? "Stop voice input" : "Use voice input"
                      }
                      aria-pressed={voice.active}
                      disabled={!!busy || voice.status === "stopping"}
                      onClick={() => {
                        setError("");
                        void voice.toggle(request);
                      }}
                    >
                      <Mic size={15} />
                      {voice.status === "stopping"
                        ? "Finishing…"
                        : voice.active
                          ? "Stop"
                          : "Speak your goal"}
                    </button>
                    <button
                      type="submit"
                      className="send-button"
                      aria-label="Build program"
                      disabled={
                        !!busy || voice.active || !request.trim() || !connected
                      }
                    >
                      <ArrowUp size={19} />
                    </button>
                  </div>
                </form>
                {voice.message && (
                  <div
                    className={
                      voice.failed ? "voice-status failed" : "voice-status"
                    }
                    role="status"
                    aria-live="polite"
                  >
                    <p>{voice.message}</p>
                    {voice.failed && (
                      <a href="/" target="_blank" rel="noopener noreferrer">
                        Open FORGE in a browser ↗
                      </a>
                    )}
                  </div>
                )}
                <div className="presets">
                  <button
                    onClick={() => setRequest(scoutRequest)}
                    disabled={!!busy || voice.active}
                  >
                    <Plus size={12} /> Internship scout
                  </button>
                  <button
                    onClick={() =>
                      setRequest(
                        active?.status === "installed"
                          ? extensionRequest
                          : householdRequest,
                      )
                    }
                    disabled={!!busy || voice.active}
                  >
                    <Plus size={12} />
                    {active?.status === "installed"
                      ? "Add cover letter"
                      : "Family briefing"}
                  </button>
                </div>
              </section>
              <div className="workbench">
                <section className="capability panel">
                  <div className="panel-header">
                    <div>
                      <GitBranch size={17} />
                      <strong>
                        {active?.definition.name ?? "Capability workspace"}
                      </strong>
                      {active && (
                        <code className="version">
                          v{active.definition.version}
                        </code>
                      )}
                    </div>
                    <span
                      className={
                        active?.status === "installed"
                          ? "status-pill"
                          : "subtle-pill"
                      }
                    >
                      {active?.status === "installed"
                        ? "INSTALLED"
                        : active?.status === "review"
                          ? "AWAITING APPROVAL"
                          : active?.status === "blocked"
                            ? "BLOCKED"
                            : active?.status === "rejected"
                              ? "REJECTED"
                              : "READY TO BUILD"}
                    </span>
                  </div>
                  <div className="review-tabs" role="tablist">
                    {tabs.map((t) => (
                      <button
                        role="tab"
                        aria-selected={tab === t}
                        key={t}
                        className={tab === t ? "selected" : ""}
                        onClick={() => setTab(t)}
                      >
                        {t}
                        {t === "Tests" && active && (
                          <span>{active.report.checks.length}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {active ? (
                    <CapabilityReview
                      release={active}
                      tab={tab}
                      execution={execution}
                    />
                  ) : (
                    <div className="empty-workspace">
                      <div className="blueprint">
                        <span />
                        <span />
                        <div>
                          <Code2 size={31} />
                        </div>
                        <span />
                        <span />
                      </div>
                      <span className="eyebrow">NOT IN THE TOOLSET. YET.</span>
                      <h2>
                        Every program
                        <br />
                        starts with a goal.
                      </h2>
                      <p>
                        Describe what’s missing. FORGE compiles a workflow,
                        <br />
                        tests its boundaries, and asks before installing.
                      </p>
                      <div className="empty-pipeline">
                        <span>Request</span>
                        <ChevronRight size={11} />
                        <span>Compile</span>
                        <ChevronRight size={11} />
                        <span>Validate</span>
                        <ChevronRight size={11} />
                        <span>Approve</span>
                      </div>
                    </div>
                  )}
                  {active && (
                    <>
                      {active.status === "review" && (
                        <div
                          className="approval-card"
                          data-testid="approval-card"
                        >
                          <span className="eyebrow">
                            YOUR APPROVAL IS REQUIRED
                          </span>
                          <h3>{active.definition.name}</h3>
                          <p>
                            {active.definition.parentVersion
                              ? `Update v${active.definition.parentVersion} → v${active.definition.version}`
                              : `Install v${active.definition.version}`}
                          </p>
                          <ul>
                            {active.definition.permissions.map((permission) => (
                              <li key={permission}>
                                {permissionLabels[permission] ?? permission}
                              </li>
                            ))}
                          </ul>
                          <p>
                            No email sending, application submission, arbitrary
                            network destinations, or unrelated file access.
                          </p>
                          <small>
                            {
                              active.report.checks.filter(
                                (check) => check.passed,
                              ).length
                            }
                            /{active.report.checks.length} checks passed ·
                            approval applies to this exact tested definition.
                          </small>
                        </div>
                      )}
                      <div className="release-footer">
                        <div>
                          <ShieldCheck size={18} />
                          <span>
                            {active.report.passed
                              ? "Validated & permission-scoped"
                              : "Validation failed"}
                            <small>
                              {active.usage.model} ·{" "}
                              {active.usage.inputTokens +
                                active.usage.outputTokens}{" "}
                              model tokens
                            </small>
                          </span>
                        </div>
                        {active.status === "review" && (
                          <div className="approval-actions">
                            <button
                              disabled={!!busy}
                              onClick={() => setTab("Permissions")}
                            >
                              Inspect
                            </button>
                            <button disabled={!!busy} onClick={reject}>
                              Reject
                            </button>
                            <button
                              className="primary-button"
                              disabled={!!busy}
                              onClick={approve}
                            >
                              Approve & install
                              <ArrowUpRight size={15} />
                            </button>
                          </div>
                        )}
                        {active.status === "installed" && (
                          <div className="invoke-control">
                            {active.definition.trigger ===
                              "new_job_posting" && (
                              <select
                                aria-label="Invocation fixture"
                                value={fixture}
                                onChange={(e) =>
                                  setFixture(
                                    e.target.value as keyof typeof postings,
                                  )
                                }
                              >
                                <option value="amd">AMD job fixture</option>
                                <option value="irrelevant">
                                  Below-threshold fixture
                                </option>
                                <option value="hostile">
                                  Hostile posting fixture
                                </option>
                                <option value="changed">
                                  Changed-schema fixture
                                </option>
                              </select>
                            )}
                            <button
                              className="primary-button"
                              disabled={!!busy}
                              onClick={invoke}
                            >
                              Invoke via MCP
                              <ArrowUpRight size={15} />
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </section>
                <section className="toolset panel">
                  <div className="panel-header">
                    <div>
                      <Terminal size={16} />
                      <strong>The actual MCP toolset</strong>
                    </div>
                    <button
                      onClick={() =>
                        void discover().catch((e) => setError(String(e)))
                      }
                      disabled={!!busy}
                    >
                      <RefreshCw size={13} /> tools/list
                    </button>
                  </div>
                  {beforeTools && (
                    <details className="proof-details" open>
                      <summary>
                        MCP discovery proof · {protocolVersion ?? "connecting"}{" "}
                        · Streamable HTTP
                      </summary>
                      <div
                        className="discovery-proof"
                        aria-label="MCP discovery proof"
                      >
                        <div data-testid="tools-before">
                          <span className="eyebrow">T0 / BEFORE BUILD</span>
                          <strong>tools/list</strong>
                          {beforeTools.map((tool) => (
                            <code key={tool.name}>{tool.name}</code>
                          ))}
                          <p>
                            {active?.definition.toolContract.name ??
                              "internship_scout"}
                            :{" "}
                            {beforeTools.some(
                              (tool) =>
                                tool.name ===
                                (active?.definition.toolContract.name ??
                                  "internship_scout"),
                            )
                              ? "already present"
                              : "absent"}
                          </p>
                        </div>
                        <div data-testid="tools-after">
                          <span className="eyebrow">
                            {active?.status === "installed"
                              ? "T1 / AFTER APPROVAL"
                              : "NOW / AWAITING APPROVAL"}
                          </span>
                          <strong>tools/list</strong>
                          {tools.map((tool) => (
                            <code
                              key={tool.name}
                              className={
                                beforeTools.some(
                                  (before) => before.name === tool.name,
                                )
                                  ? ""
                                  : "new-tool"
                              }
                            >
                              {tool.name}
                              {beforeTools.some(
                                (before) => before.name === tool.name,
                              )
                                ? ""
                                : " · NEW"}
                            </code>
                          ))}
                          <p>Actual responses from this MCP client.</p>
                        </div>
                      </div>
                    </details>
                  )}
                  <div className="toolset-content">
                    <div className="tool-chips">
                      {tools.map((tool) => (
                        <div
                          key={tool.name}
                          className={
                            tool.name.startsWith("forge.")
                              ? "tool-chip"
                              : "tool-chip custom"
                          }
                        >
                          <span className="tool-dot" />
                          <code>{tool.name}</code>
                          {!tool.name.startsWith("forge.") && (
                            <span>INSTALLED</span>
                          )}
                        </div>
                      ))}
                      {!tools.length && (
                        <span className="muted">
                          Connect to discover server tools.
                        </span>
                      )}
                      <p>
                        Tools appear here only after approval and discovery.
                        This is a web simulator; a live Alexa+ connection has
                        not been established.
                      </p>
                    </div>
                    <div className="protocol-log">
                      <span className="eyebrow">PROTOCOL ACTIVITY</span>
                      {protocol.slice(0, 4).map((line, i) => (
                        <div key={`${line}-${i}`}>
                          <span>›</span>
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
          {view === "Capabilities" && (
            <section className="panel library">
              <div className="panel-header">
                <strong>Program releases</strong>
                <span>{snapshot?.releases.length ?? 0} releases</span>
              </div>
              {snapshot?.releases.length ? (
                [...snapshot.releases].reverse().map((release) => (
                  <div
                    className="library-row"
                    key={release.digest}
                    data-capability-id={release.definition.id}
                  >
                    <div className="library-icon">
                      <Boxes size={21} />
                    </div>
                    <div>
                      <strong>
                        {release.definition.name}{" "}
                        <code>v{release.definition.version}</code>
                      </strong>
                      <p>
                        {release.definition.toolContract.name} ·{" "}
                        {release.status} ·{" "}
                        {release.report.checks.filter((c) => c.passed).length}/
                        {release.report.checks.length} checks
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSelected(release);
                        setExecution(undefined);
                        setView("Studio");
                        setTab("Workflow");
                      }}
                    >
                      Inspect
                      <ArrowUpRight size={14} />
                    </button>
                    {release.approvedAt && release.status !== "installed" && (
                      <button
                        disabled={!!busy}
                        onClick={() => void rollback(release)}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <div className="empty-tab">
                  <h3>Your toolset starts here.</h3>
                  <p>Build and approve a program in the studio.</p>
                </div>
              )}
            </section>
          )}
          {view === "Executions" && (
            <>
              <div className="metrics-grid">
                {[
                  {
                    label: "EXECUTIONS",
                    value: snapshot?.metrics.executionCount ?? 0,
                  },
                  {
                    label: "SUCCESS RATE",
                    value:
                      snapshot?.metrics.successRate == null
                        ? "—"
                        : `${snapshot.metrics.successRate}%`,
                  },
                  {
                    label: "P95 LATENCY",
                    value:
                      snapshot?.metrics.p95LatencyMs == null
                        ? "—"
                        : `${Math.round(snapshot.metrics.p95LatencyMs)} ms`,
                  },
                  {
                    label: "RUNTIME COST",
                    value: `$${(snapshot?.metrics.estimatedCost ?? 0).toFixed(4)}`,
                  },
                ].map((metric) => (
                  <div className="panel metric" key={metric.label}>
                    <span className="eyebrow">{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                ))}
              </div>
              <section className="panel library">
                <div className="panel-header">
                  <strong>Actual execution history</strong>
                  <span>
                    {snapshot?.metrics.failures ?? 0} failures ·{" "}
                    {snapshot?.metrics.permissionDenials ?? 0} runtime denials
                  </span>
                </div>
                {snapshot?.executions.length ? (
                  [...snapshot.executions].reverse().map((run) => (
                    <button
                      className="execution-row"
                      key={run.id}
                      onClick={() => {
                        setSelected(
                          snapshot.releases.find(
                            (r) =>
                              r.definition.id === run.capabilityId &&
                              r.definition.version === run.version,
                          ),
                        );
                        setExecution(run);
                        setTab("Trace");
                        setView("Studio");
                      }}
                    >
                      <span
                        className={
                          run.status === "success"
                            ? "live-dot"
                            : "live-dot offline"
                        }
                      />
                      <div>
                        <strong>
                          {run.capabilityId} <code>v{run.version}</code>
                        </strong>
                        <p>
                          {run.eventId} · {run.trace.length} trace steps ·{" "}
                          {run.status}
                        </p>
                      </div>
                      <span>{run.latencyMs} ms</span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))
                ) : (
                  <div className="empty-tab">
                    <h3>Nothing has run yet.</h3>
                    <p>Install a tool and invoke it through MCP.</p>
                  </div>
                )}
              </section>
              <section className="panel effect-list">
                <div className="panel-header">
                  <strong>Persisted demo notifications & documents</strong>
                  <span>Local effects, real writes</span>
                </div>
                {Object.entries(snapshot?.effects ?? {}).map(
                  ([key, effect]) => (
                    <details key={key}>
                      <summary>
                        {effect.kind} · {effect.capabilityId} · {effect.eventId}
                      </summary>
                      <pre>{effect.content}</pre>
                    </details>
                  ),
                )}
              </section>
            </>
          )}
          {view === "Architecture" && (
            <section className="panel architecture">
              <span className="eyebrow">
                A SELF-HOSTED MCP SERVER THAT GROWS ITS TOOLSET
              </span>
              <h2>
                A goal becomes a contract.
                <br />
                Approval makes it a tool.
              </h2>
              <div className="architecture-flow">
                {[
                  "MCP client / simulator",
                  `Capability compiler: ${runtimeInfo?.compilerProvider ?? "loading configuration"}`,
                  "Validated ForgeSpec + DAG",
                  "Executable tests + ForgeGuard",
                  "Human approval + digest",
                  "MCP tool registry",
                  "Permission broker + isolated worker",
                ].map((label, i) => (
                  <div key={label}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <strong>{label}</strong>
                    <ChevronRight size={15} />
                  </div>
                ))}
              </div>
              <div className="architecture-notes">
                <div>
                  <h3>Local first</h3>
                  <p>
                    Deterministic compiler, fixture data, atomic local storage,
                    actual SDK transport and process isolation. The workflow and
                    tool contracts are generated; external integrations are
                    simulated.
                  </p>
                </div>
                <div>
                  <h3>AWS compilation path</h3>
                  <p>
                    AWS mode calls Bedrock Converse to propose ForgeSpec;
                    schema, policy, tests and owner approval still apply.
                    DynamoDB, EventBridge and CloudWatch are optional. Fixture
                    mode makes no compiler cloud call. Live cloud connectivity
                    and deployment remain unverified.
                  </p>
                </div>
                <div>
                  <h3>Protocol, accurately</h3>
                  <p>
                    Streamable HTTP uses SDK protocol negotiation. This
                    stateless simulator re-queries tools/list after
                    installation. It does not claim unsolicited updates to a
                    connected Alexa device.
                  </p>
                </div>
              </div>
            </section>
          )}
          <footer className="page-footer">
            <span>
              <Flame size={12} /> FORGE / Give AI goals, not features.
            </span>
            <span>
              Built for Amazon Build, Ship, Shape 2026{" "}
              <ArrowUpRight size={11} />
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
