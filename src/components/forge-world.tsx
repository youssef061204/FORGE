"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ArrowUpRight,
  Sun,
  Moon,
  ShieldCheck,
  Zap,
  Sparkles,
  DoorClosed,
  Cpu,
  Flame,
  ChevronRight,
  RotateCcw,
  Play,
  Plus,
  LoaderCircle,
  LockKeyhole,
  Maximize2,
  Minimize2,
  Mail,
  SlidersHorizontal,
  ScanLine,
} from "lucide-react";
import { connectSimulator } from "@/forge/browser-mcp";
import {
  stateSchema,
  releaseSchema,
  executionSchema,
  buildProgressSchema,
  type State,
  type Release,
  type Execution,
  type BuildProgress,
} from "@/forge/records";
import {
  createWorld,
  energyKw,
  worldRequests,
  worldOperations,
} from "@/forge/world";
import { CapabilityReview, type ReviewTab } from "./review";
import { WorldScene } from "./world-scene";
import { useOptionalForgeApplication } from "./forge-application";
import { AbilityIcon, GameDialog, Forging, WorldEventFeed } from "./world-hud";

const reviewTabs: ReviewTab[] = [
  "Workflow",
  "Tests",
  "Permissions",
  "ForgeSpec",
  "Trace",
];
export function ForgeWorld() {
  const [snapshot, setSnapshot] = useState<State>();
  const [tools, setTools] = useState<string[]>([]);
  const [beforeTools, setBeforeTools] = useState<string[]>([]);
  const [selected, setSelected] = useState<Release>();
  const [execution, setExecution] = useState<Execution>();
  const [request, setRequest] = useState(worldRequests.leaving);
  const [busy, setBusy] = useState("");
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(
    "Start with a goal. Your apartment has primitives, but no routines yet.",
  );
  const application = useOptionalForgeApplication();
  const [localToken, setLocalToken] = useState("");
  const token = application?.token ?? localToken;
  const setToken = application?.setToken ?? setLocalToken;
  const [authToken, setAuthToken] = useState("");
  const [tab, setTab] = useState<ReviewTab>("Workflow");
  const [buildId, setBuildId] = useState<string>();
  const [progress, setProgress] = useState<BuildProgress>();
  const [runtimeInfo, setRuntimeInfo] = useState<{
    runtimeMode: string;
    compilerProvider: string;
    modelId: string;
  }>();
  const client = useRef<Client | null>(null);
  const busyRef = useRef(false);
  const actionGeneration = useRef(0);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [mailOpen, setMailOpen] = useState(false);
  const [scenesOpen, setScenesOpen] = useState(false);
  const [cinematic, setCinematic] = useState(false);
  const [celebration, setCelebration] = useState("");
  const [motion, setMotion] = useState<{
    id: string;
    from: "home" | "away";
    to: "home" | "away";
    studying: boolean;
    fromStudying: boolean;
  }>();
  const [guardImpact, setGuardImpact] = useState("");
  const [forgedRelease, setForgedRelease] = useState<Release>();
  useEffect(() => {
    if (!forgedRelease) return;
    const timer = setTimeout(() => setForgedRelease(undefined), 2400);
    return () => clearTimeout(timer);
  }, [forgedRelease]);
  const world = snapshot?.world ?? createWorld();
  const installed =
    snapshot?.releases.filter(
      (r) =>
        r.status === "installed" &&
        r.definition.nodes.some((n) =>
          worldOperations.includes(
            n.operation as (typeof worldOperations)[number],
          ),
        ),
    ) ?? [];
  const current = selected
    ? (snapshot?.releases.find((r) => r.digest === selected.digest) ?? selected)
    : undefined;
  const compilationDuration = current?.buildStages?.find(
    (s) => s.name === "Creating ForgeSpec",
  )?.durationMs;
  const compilerLabel =
    current?.usage.model === "deterministic-planner"
      ? "Fixture compiler · 0 model tokens"
      : current?.usage.model === "registry"
        ? "Installed registry"
        : `Forged by Amazon Bedrock${current?.usage.model.includes("claude-sonnet-4-5") ? " · Claude Sonnet 4.5" : ""}${compilationDuration === undefined ? "" : ` · ${(compilationDuration / 1000).toFixed(1)}s`}`;

  useEffect(() => {
    let cancelled = false;
    let active: Client | undefined;
    const headers = authToken
      ? { Authorization: `Bearer ${authToken}` }
      : undefined;
    void (async () => {
      try {
        const [stateResponse, healthResponse] = await Promise.all([
          fetch("/api/forge", { headers, cache: "no-store" }),
          fetch("/api/health", { cache: "no-store" }),
        ]);
        const state = await stateResponse.json();
        if (!stateResponse.ok)
          throw new Error(state.error ?? "Owner access required");
        active = await connectSimulator(authToken || undefined, "fixture");
        const list = await active.listTools();
        const health = await healthResponse.json();
        if (cancelled) {
          await active.close();
          return;
        }
        client.current = active;
        setSnapshot(stateSchema.parse(state));
        if (
          state.releases.some(
            (r: Release) =>
              r.status === "installed" &&
              r.definition.nodes.some((n) =>
                worldOperations.includes(
                  n.operation as (typeof worldOperations)[number],
                ),
              ),
          )
        )
          setNotice(
            "Your approved world abilities are ready. Select one below to inspect or run it.",
          );
        setRuntimeInfo(health);
        setTools(list.tools.map((t) => t.name));
        setBeforeTools(list.tools.map((t) => t.name));
        setConnected(true);
        setError("");
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "MCP connection failed");
        if (active) await active.close();
      }
    })();
    return () => {
      cancelled = true;
      client.current = null;
      void active?.close();
    };
  }, [authToken]);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    let polling = false;
    const poll = async () => {
      if (polling || busyRef.current) return;
      const generation = actionGeneration.current;
      polling = true;
      try {
        const response = await fetch("/api/forge", {
          signal: controller.signal,
          cache: "no-store",
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
        });
        const result = response.ok
          ? stateSchema.parse(await response.json())
          : undefined;
        if (
          result &&
          !controller.signal.aborted &&
          !busyRef.current &&
          generation === actionGeneration.current
        )
          setSnapshot(result);
      } catch {
        /* Explicit actions surface errors; polling resumes next tick. */
      } finally {
        polling = false;
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, 1500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [connected, authToken]);
  useEffect(() => {
    if (!buildId) return;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch(`/api/forge?buildId=${buildId}`, {
          signal: controller.signal,
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
          cache: "no-store",
        });
        const result = buildProgressSchema.safeParse(await response.json());
        if (result.success && !controller.signal.aborted)
          setProgress(result.data);
      } catch {
        /* Final MCP build result remains authoritative. */
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, 350);
    void poll();
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [buildId, authToken]);
  async function refresh() {
    const response = await fetch("/api/forge", {
      cache: "no-store",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "State refresh failed");
    const state = stateSchema.parse(json);
    setSnapshot(state);
    if (client.current)
      setTools((await client.current.listTools()).tools.map((t) => t.name));
    return state;
  }
  async function ownerAction(body: Record<string, unknown>) {
    const response = await fetch("/api/forge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error ?? "Owner action failed");
    setSnapshot(stateSchema.parse(json.snapshot));
    return json.result;
  }
  async function act(label: string, fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    actionGeneration.current++;
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      busyRef.current = false;
      setBusy("");
      setBuildId(undefined);
    }
  }
  function build(event: FormEvent) {
    event.preventDefault();
    void act("Forging capability", async () => {
      if (!client.current) throw new Error("Connect to MCP first");
      setBeforeTools(
        (await client.current.listTools()).tools.map((t) => t.name),
      );
      const id = crypto.randomUUID();
      setBuildId(id);
      setProgress(undefined);
      const result = await client.current.callTool(
        { name: "forge.build", arguments: { request, buildId: id } },
        undefined,
        { timeout: 120000 },
      );
      const text =
        result.content && Array.isArray(result.content)
          ? result.content.find((c) => c.type === "text")?.text
          : undefined;
      if (result.isError || typeof text !== "string")
        throw new Error(typeof text === "string" ? text : "Compilation failed");
      const release = releaseSchema.parse(JSON.parse(text));
      setSelected(release);
      if (release.status === "review") setForgedRelease(release);
      setExecution(undefined);
      setTab("Workflow");
      await refresh();
      setNotice(
        release.status === "blocked"
          ? "Validation blocked this proposal. Inspect the checks."
          : release.status === "installed"
            ? "This capability already exists. Ready to run."
            : `${release.resolution}: ${release.definition.nodes.length} trusted primitives. ${release.report.checks.filter((c) => c.passed).length}/${release.report.checks.length} checks passed. Your approval is next.`,
      );
    });
  }
  function approve() {
    if (!current) return;
    void act("Installing capability", async () => {
      const installedRelease = releaseSchema.parse(
        await ownerAction({
          action: "approve",
          id: current.definition.id,
          version: current.definition.version,
          digest: current.digest,
        }),
      );
      setSelected(installedRelease);
      await refresh();
      setCelebration(
        `ABILITY UNLOCKED · ${installedRelease.definition.name} · v${installedRelease.definition.version}`,
      );
      setNotice(
        `New ability unlocked: ${installedRelease.definition.toolContract.name} · v${installedRelease.definition.version}`,
      );
    });
  }
  function invoke() {
    if (!current) return;
    setForgedRelease(undefined);
    const from = world.presence;
    void act("Updating your world", async () => {
      if (!client.current) throw new Error("Connect to MCP first");
      const result = await client.current.callTool({
        name: current.definition.toolContract.name,
        arguments: {
          eventId: `world-${crypto.randomUUID()}`,
          text: "Apply the approved apartment routine.",
        },
      });
      const run = executionSchema.parse(result.structuredContent);
      setExecution(run);
      const state = await refresh();
      if (result.isError || run.status !== "success")
        throw new Error(run.error ?? "World execution failed");
      setMotion({
        id: run.id,
        from,
        to: state.world?.presence ?? "home",
        studying: current.definition.id === "study-mode",
        fromStudying: !!motion?.studying && from === "home" && world.computerOn,
      });
      setCelebration("");
      setNotice(
        `World updated by ${current.definition.toolContract.name} · ${run.trace.length} broker steps · ${run.latencyMs} ms`,
      );
    });
  }
  function scene(preset: "active-day" | "night-arrival" | "away-45") {
    void act("Preparing scene", async () => {
      await ownerAction({ action: "world_scene", scene: preset });
      setMotion(undefined);
      setExecution(undefined);
      setGuardImpact("");
      setCelebration("");
      setNotice(
        "Simulation input prepared. Installed abilities and version history are preserved.",
      );
    });
  }
  function attack() {
    void act("Testing delivery message", async () => {
      await ownerAction({ action: "world_attack" });
      setGuardImpact(crypto.randomUUID());
      setNotice(
        "Threat blocked. The broker denied door.unlock; the door state is unchanged.",
      );
    });
  }
  function rollback(release: Release) {
    void act("Restoring approved version", async () => {
      const result = releaseSchema.parse(
        await ownerAction({
          action: "rollback",
          id: release.definition.id,
          version: release.definition.version,
        }),
      );
      setSelected(result);
      await refresh();
      setCelebration(
        `ROLLBACK · ${release.definition.name} · v${current?.definition.version} → v${result.definition.version}`,
      );
      setNotice(
        `Restored v${result.definition.version}. Run it to apply the earlier behavior.`,
      );
    });
  }
  function resetDemo() {
    void act("Resetting World demo", async () => {
      await ownerAction({ action: "world_reset" });
      const state = await refresh();
      setBeforeTools(
        (await client.current!.listTools()).tools.map((t) => t.name),
      );
      setSelected(undefined);
      setExecution(undefined);
      setMotion(undefined);
      setForgedRelease(undefined);
      setGuardImpact("");
      setCelebration("");
      setRequest(worldRequests.leaving);
      setScenesOpen(false);
      setNotice(
        `World demo reset. ${state.releases.filter((r) => r.status === "installed").length} unrelated installed capabilities preserved.`,
      );
    });
  }
  return (
    <main
      className={`forge-world world-game ${cinematic ? "is-cinematic" : ""}`}
    >
      <header className="game-topbar">
        <Link href="/studio" className="world-brand">
          <span className="brand-pixel">
            <Flame size={20} />
          </span>
          <strong>
            FORGE <small>WORLD</small>
          </strong>
        </Link>
        <span className="world-place">
          Mika&apos;s apartment <small>· Mosswood</small>
        </span>
        <div className="game-top-actions">
          <span className="world-connection">
            <i className={connected ? "connected" : ""} />
            {connected ? "MCP connected" : "Connecting"}
          </span>
          <button
            onClick={() => setCinematic(!cinematic)}
            aria-pressed={cinematic}
            title="A larger world for recording"
          >
            {cinematic ? <Minimize2 size={15} /> : <Maximize2 size={15} />}Demo
            mode
          </button>
          <Link href="/studio">
            Studio <ArrowUpRight size={13} />
          </Link>
          <Link href="/live">
            FORGE Live <ArrowUpRight size={13} />
          </Link>
        </div>
      </header>

      <section
        className={`world-arena time-${world.timeOfDay}`}
        aria-label="Mika's apartment simulation"
      >
        <div className="world-hud">
          <div className="hud-time">
            {world.timeOfDay === "night" ? (
              <Moon size={17} />
            ) : (
              <Sun size={17} />
            )}
            <span>
              {world.timeOfDay}
              <strong>
                {Math.floor((world.minute % 1440) / 60)
                  .toString()
                  .padStart(2, "0")}
                :{(world.minute % 60).toString().padStart(2, "0")}
              </strong>
            </span>
          </div>
          <div className="hud-energy">
            <Zap size={20} />
            <div>
              <strong data-testid="world-energy">
                {energyKw(world).toFixed(2)} <small>kW</small>
              </strong>
              <div className="energy-track" aria-label="Simulated energy load">
                <span
                  style={{
                    width: `${Math.min(100, (energyKw(world) / 3) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <span className="pixel-label">
              SIMULATED
              <br />
              ENERGY
            </span>
          </div>
          <div className="hud-temperature">
            <Flame size={16} />
            <strong data-testid="world-temperature" key={world.temperature}>
              {world.temperature}°C
            </strong>
          </div>
        </div>

        <div className="world-stage" data-testid="world-stage">
          <WorldScene
            world={world}
            running={busy === "Updating your world"}
            motion={motion}
            guardImpact={guardImpact}
          />
          {busy === "Forging capability" && (
            <Forging progress={progress} working />
          )}
          {busy !== "Forging capability" && forgedRelease && (
            <Forging release={forgedRelease} working={false} />
          )}
          {celebration && (
            <div
              className="ability-celebration"
              key={celebration}
              role="status"
            >
              <Sparkles size={22} />
              <span>{celebration}</span>
            </div>
          )}
          {world.alert && (
            <div
              className="world-threat"
              key={guardImpact || world.alert.at}
              role="status"
            >
              <span className="guard-shield">
                <ShieldCheck size={32} />
              </span>
              <div>
                <strong>THREAT BLOCKED</strong>
                <p>Untrusted mailbox content cannot request physical access.</p>
                <blockquote>{world.mailbox.at(-1)}</blockquote>
                <code>{world.alert.operation} · DENIED</code>
                <small>
                  Front door {world.doorLocked ? "remains locked" : "unchanged"}{" "}
                  · {world.alert.permissionDenials} actual broker denial
                </small>
              </div>
              <button
                onClick={() => {
                  setTab("Tests");
                  setInspectorOpen(true);
                }}
              >
                Inspect decision <ChevronRight size={14} />
              </button>
            </div>
          )}
          <WorldEventFeed execution={execution} />
        </div>

        <aside className="world-satchel" aria-label="World abilities">
          <div className="satchel-heading">
            <span className="pixel-label">YOUR ABILITIES</span>
            <span>{installed.length} unlocked</span>
          </div>
          <div className="ability-inventory">
            {installed.length ? (
              installed.map((r) => (
                <button
                  key={r.digest}
                  className={`ability-slot ${current?.digest === r.digest ? "selected" : ""}`}
                  disabled={!!busy}
                  onClick={() => {
                    setSelected(r);
                    setExecution(
                      snapshot?.executions
                        .filter((e) => e.capabilityId === r.definition.id)
                        .at(-1),
                    );
                  }}
                  aria-label={`Select ${r.definition.name}`}
                >
                  <span className="ability-icon">
                    <AbilityIcon id={r.definition.id} />
                  </span>
                  <span>
                    <strong>{r.definition.name}</strong>
                    <small>v{r.definition.version}</small>
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-inventory">
                <span className="empty-slot">
                  <Sparkles size={24} />
                </span>
                <strong>Your first ability awaits.</strong>
                <p>
                  {worldOperations.length} trusted primitives.
                  <br />
                  No home routine installed.
                </p>
              </div>
            )}
          </div>

          {current && (
            <div
              className={`world-proposal ${current.status === "review" ? "proposal-arrival" : ""}`}
              data-testid="world-proposal"
              key={current.digest}
            >
              <span className="pixel-label">
                {current.status === "installed"
                  ? "ABILITY UNLOCKED"
                  : current.definition.parentVersion
                    ? "UPGRADE AVAILABLE"
                    : current.status === "blocked"
                      ? "VALIDATION BLOCKED"
                      : "NEW ABILITY"}{" "}
                <b>{current.resolution}</b>
              </span>
              <h2>
                <AbilityIcon id={current.definition.id} size={20} />
                {current.definition.name}
              </h2>
              <span className="version-ribbon">
                {current.definition.parentVersion && current.status === "review"
                  ? `v${current.definition.parentVersion} → `
                  : ""}
                v{current.definition.version}
              </span>
              <div className="proposal-proof">
                <ShieldCheck size={13} />
                {current.report.checks.filter((c) => c.passed).length}/
                {current.report.checks.length} checks passed
                <span>· {current.definition.nodes.length} primitives</span>
              </div>
              {current.status === "review" && (
                <>
                  {current.definition.parentVersion && (
                    <div className="upgrade-diff">
                      <strong>
                        +{" "}
                        {current.diff.addedNodes.join(", ") ||
                          "updated primitive configuration"}
                      </strong>
                      <small>
                        Thermostat{" "}
                        {
                          current.definition.nodes.find(
                            (n) => n.operation === "thermostat.set",
                          )?.config.temperature
                        }
                        °C after{" "}
                        {current.definition.nodes.find(
                          (n) => n.operation === "thermostat.set",
                        )?.config.minAwayMinutes ?? 0}{" "}
                        simulated min away, evaluated when invoked.
                      </small>
                    </div>
                  )}
                  <details className="approval-permissions" open>
                    <summary>Review scoped permissions</summary>
                    <div>
                      {current.definition.permissions.map((p) => (
                        <code
                          key={p}
                          className={
                            current.diff.addedPermissions.includes(p) &&
                            !!current.definition.parentVersion
                              ? "permission-added"
                              : ""
                          }
                        >
                          {p}
                        </code>
                      ))}
                    </div>
                  </details>
                  <div className="approval-actions">
                    <button
                      className="game-primary"
                      disabled={!!busy || !current.report.passed}
                      onClick={approve}
                    >
                      <LockKeyhole size={15} />
                      Approve & install
                    </button>
                    <button
                      disabled={!!busy}
                      onClick={() => {
                        void act("Rejecting proposal", async () => {
                          await ownerAction({
                            action: "reject",
                            id: current.definition.id,
                            version: current.definition.version,
                            digest: current.digest,
                          });
                          setSelected(undefined);
                          setNotice(
                            "Proposal rejected. World and installed tools unchanged.",
                          );
                        });
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </>
              )}
              {current.status === "installed" && (
                <button
                  className="game-primary run-ability"
                  disabled={!!busy}
                  onClick={invoke}
                >
                  <Play size={14} fill="currentColor" />
                  Run {current.definition.toolContract.name}
                </button>
              )}
              {current.status === "blocked" && (
                <p>
                  Installation blocked. Inspect Tests for the actual failures.
                </p>
              )}
              <small className="world-provider">{compilerLabel} </small>
            </div>
          )}

          {installed.some((r) => r.definition.id === "leaving-home") && (
            <button
              className="world-extend"
              disabled={!!busy}
              onClick={() => {
                setRequest(worldRequests.extend);
                setCelebration("");
              }}
            >
              <Plus size={14} />
              Teach Leaving Home something new
            </button>
          )}
          {current &&
            snapshot?.releases
              .filter(
                (r) =>
                  r.definition.id === current.definition.id &&
                  r.approvedAt &&
                  r.definition.version !== current.definition.version,
              )
              .map((r) => (
                <button
                  className="world-rollback"
                  key={r.digest}
                  disabled={!!busy}
                  onClick={() => rollback(r)}
                >
                  <RotateCcw size={13} />
                  Rollback to v{r.definition.version}
                </button>
              ))}
          {busy === "Forging capability" && (
            <div className="observed-progress">
              <span className="pixel-label">ACTUAL BUILD STAGES</span>
              {progress?.stages.map((s) => (
                <div key={s.name}>
                  <span>{s.durationMs === undefined ? "◌" : "✓"}</span>
                  {s.name}
                </div>
              ))}
            </div>
          )}
        </aside>

        <div className="world-bottom-hud">
          <span>
            <DoorClosed size={14} />
            <strong data-testid="world-door">
              {world.doorLocked ? "Locked" : "Unlocked"}
            </strong>
          </span>
          <span className="presence-chip">
            <i />
            <strong data-testid="world-presence">
              {world.presence === "home" ? "Home" : "Away"}
            </strong>
          </span>
          <span data-testid="world-lights">
            {Object.values(world.lights).filter(Boolean).length}/5 lights on
          </span>
          <span className="device-label">
            Computer {world.computerOn ? "on" : "off"}
          </span>
          <span className="device-label">TV {world.tvOn ? "on" : "off"}</span>
          <span className="device-label">
            Appliances {world.appliancesOn ? "on" : "off"}
          </span>
        </div>
        <div className="world-toolbar">
          <button
            onClick={() => setMailOpen(true)}
            className={world.alert ? "mail-alert" : ""}
          >
            <Mail size={18} />
            Mail & Guard{world.alert && <i />}
          </button>
          <button onClick={() => setScenesOpen(true)}>
            <SlidersHorizontal size={17} />
            Scene inputs
          </button>
          <button
            onClick={() => {
              setInspectorOpen(true);
              void act("Refreshing MCP proof", async () => {
                await refresh();
              });
            }}
          >
            <ScanLine size={17} />
            Inspect MCP
          </button>
        </div>
      </section>

      <section className="world-command" aria-label="Ask FORGE">
        <div className="command-portrait">
          <Flame size={27} />
          <span>FORGE</span>
        </div>
        <form onSubmit={build}>
          <label htmlFor="world-request">
            Tell FORGE what you want the world to do.
          </label>
          <div className="command-input">
            <textarea
              id="world-request"
              aria-label="World program request"
              aria-describedby="world-device-support"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              maxLength={4000}
              rows={2}
            />
            <button
              className="game-primary"
              type="submit"
              disabled={!!busy || !connected || request.trim().length < 5}
            >
              {busy === "Forging capability" ? (
                <LoaderCircle size={18} className="spin" />
              ) : (
                <Sparkles size={18} />
              )}
              {busy === "Forging capability" ? "Forging…" : "Forge capability"}
            </button>
          </div>
          <div className="world-suggestions">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setRequest(worldRequests.leaving)}
            >
              <DoorClosed size={12} />
              Leaving home
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setRequest(worldRequests.welcome)}
            >
              <Moon size={12} />
              Welcome home
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setRequest(worldRequests.study)}
            >
              <Cpu size={12} />
              Study mode
            </button>
          </div>
          <small id="world-device-support">
            Available devices: lights, door lock, thermostat, computer, TV and
            appliances. Music playback is not connected.
          </small>
        </form>
        <div className="command-meta">
          <span className="compiler-badge">
            {runtimeInfo?.runtimeMode === "aws"
              ? "AMAZON BEDROCK"
              : "FIXTURE COMPILER"}
          </span>
          <small>Simulated devices · real execution</small>
        </div>
        <div className="world-notice" aria-live="polite">
          {error ? (
            <span className="world-error" role="alert">
              {error}
            </span>
          ) : (
            notice
          )}
        </div>
      </section>

      <GameDialog
        open={inspectorOpen}
        onClose={() => setInspectorOpen(false)}
        title="Inspect MCP"
        kind="technical-dialog"
      >
        <p className="drawer-intro">
          Same world. Actual server evidence.{" "}
          <strong>{runtimeInfo?.compilerProvider}</strong>
        </p>
        <div className="world-tool-proof">
          <div>
            <span className="pixel-label">T0 · BEFORE BUILD</span>
            <pre data-testid="world-tools-before">
              {beforeTools.join("\n") || "Connecting…"}
            </pre>
          </div>
          <div>
            <span className="pixel-label">T1 · CURRENT TOOLS/LIST</span>
            <pre data-testid="world-tools-after">
              {tools.join("\n") || "Connecting…"}
            </pre>
          </div>
        </div>
        <div className="registry-diff">
          {tools
            .filter((t) => !beforeTools.includes(t))
            .map((t) => (
              <div key={t}>
                <Plus size={14} />
                <code>{t}</code>
                <span>
                  v
                  {installed.find((r) => r.definition.toolContract.name === t)
                    ?.definition.version ?? "installed"}
                </span>
              </div>
            ))}
        </div>
        <details>
          <summary>
            Trusted world primitive catalogue ({worldOperations.length})
          </summary>
          <p>{worldOperations.join(" · ")}</p>
        </details>
        {current && (
          <>
            <div
              className="world-review-tabs"
              role="tablist"
              aria-label="World technical review"
            >
              {reviewTabs.map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="world-review">
              <CapabilityReview
                release={current}
                tab={tab}
                execution={execution}
              />
            </div>
            <details>
              <summary>Provider, usage and version history</summary>
              <p>
                Model: {current.usage.model} · {current.usage.inputTokens} input
                / {current.usage.outputTokens} output tokens
              </p>
              <p>{runtimeInfo?.modelId}</p>
              {snapshot?.releases
                .filter((r) => r.definition.id === current.definition.id)
                .map((r) => (
                  <p key={r.digest}>
                    v{r.definition.version} · {r.status} · {r.resolution} ·{" "}
                    {r.approvedAt ? "approved" : "unapproved"}
                  </p>
                ))}
            </details>
          </>
        )}
        {world.alert && (
          <div className="guard-evidence">
            <h3>Actual broker decision</h3>
            <pre>{JSON.stringify(world.alert, null, 2)}</pre>
            <blockquote>{world.mailbox.at(-1)}</blockquote>
          </div>
        )}
      </GameDialog>

      <GameDialog
        open={mailOpen}
        onClose={() => setMailOpen(false)}
        title="Mailbox & FORGE Guard"
        kind="mail-dialog"
      >
        <div className="letter-seal">
          <Mail size={28} />
        </div>
        <span className="pixel-label">DELIVERY MESSAGE · UNTRUSTED DATA</span>
        <blockquote>{world.mailbox.at(-1)}</blockquote>
        <p>
          A delivery cannot choose your apartment&apos;s operations or
          permissions. Test the actual installed Leaving Home broker with an
          attempted <code>door.unlock</code>.
        </p>
        <button
          className="game-primary"
          disabled={
            !!busy || !installed.some((r) => r.definition.id === "leaving-home")
          }
          onClick={() => {
            setMailOpen(false);
            attack();
          }}
        >
          <ShieldCheck size={17} />
          Test malicious delivery
        </button>
        <small>
          Real red-team probe. The broker decision appears on the world.
        </small>
      </GameDialog>

      <GameDialog
        open={scenesOpen}
        onClose={() => setScenesOpen(false)}
        title="Prepare a demo scene"
        kind="scene-dialog"
      >
        <p>
          Owner simulation inputs. These prepare conditions; they never execute
          an ability.
        </p>
        <div className="scene-presets">
          {(
            [
              [
                "active-day",
                "Active day",
                "Home · daytime · 24°C · devices on",
              ],
              [
                "night-arrival",
                "Night arrival",
                "Away · night · lamps and devices off",
              ],
              [
                "away-45",
                "Away for 45 min",
                "45 simulated minutes away · compare versions",
              ],
            ] as const
          ).map(([preset, name, detail]) => (
            <button
              key={preset}
              disabled={!!busy || !connected}
              onClick={() => {
                setScenesOpen(false);
                scene(preset);
              }}
            >
              <Sun size={18} />
              <span>
                <strong>{name}</strong>
                <small>{detail}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <div className="demo-reset">
          <h3>A pristine World take</h3>
          <p>
            Reset daytime, home, 24°C, lights and devices on. Removes only
            entirely World-domain program histories, executions and effects.
            Keeps Internship Scout, other domains and the audit trail.
          </p>
          <button disabled={!!busy || !connected} onClick={resetDemo}>
            <RotateCcw size={15} />
            Reset World demo
          </button>
        </div>
      </GameDialog>

      {error && !connected && (
        <GameDialog
          open={!connected && !!error}
          onClose={() => setError("")}
          title="Connect as owner"
        >
          <p>{error}</p>
          <label htmlFor="world-owner-token">Owner token</label>
          <input
            id="world-owner-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <button className="game-primary" onClick={() => setAuthToken(token)}>
            Connect
          </button>
        </GameDialog>
      )}
    </main>
  );
}
