"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Play,
  Pause,
  ArrowRight,
  Download,
  Upload,
  Mic,
  CalendarDays,
  Mail,
  Package,
  Check,
  Search,
  Sparkles,
} from "lucide-react";
import { connectSimulator } from "@/forge/browser-mcp";
import { releaseSchema, stateSchema, type State } from "@/forge/records";
import { guardianRequest } from "@/forge/replay-fixtures";
import { replaySchema, type Replay } from "@/forge/live-contracts";
import { useVoiceInput } from "./use-voice-input";
import { useOptionalForgeApplication } from "./forge-application";
type GoogleStatus = {
  configured: boolean;
  connected: boolean;
  calendarWriteConsent: boolean;
  calendarConfigured: boolean;
  sendersConfigured: boolean;
};

export function ForgeLive({ gallery = false }: { gallery?: boolean }) {
  const [state, setState] = useState<State>();
  const [google, setGoogle] = useState<GoogleStatus>();
  const [connector, setConnector] = useState<"fixture" | "google">("fixture");
  const [request, setRequest] = useState(guardianRequest);
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState(
    "Describe what you need. Before it changes your calendar, see what it would have done.",
  );
  const [error, setError] = useState("");
  const application = useOptionalForgeApplication();
  const [localToken, setLocalToken] = useState("");
  const token = application?.token ?? localToken;
  const setToken = application?.setToken ?? setLocalToken;
  const [replay, setReplay] = useState<Replay>();
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [inspect, setInspect] = useState(false);
  const [admission, setAdmission] = useState<unknown>();
  const [tools, setTools] = useState<{ before: string[]; after: string[] }>({
    before: [],
    after: [],
  });
  const [capsule, setCapsule] = useState<unknown>();
  const [importNotice, setImportNotice] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  const voice = useVoiceInput(setRequest);
  const release =
    state?.releases.find((r) => r.digest === selected) ??
    [...(state?.releases ?? [])]
      .reverse()
      .find((r) =>
        gallery
          ? Boolean(r.definition.executable)
          : r.definition.executable?.interface === "deadline/v1",
      );
  const cityArtifact = release?.definition.executable?.interface === "city/v1";
  const trust = release && state?.live?.trust[release.digest];
  const identity = release
    ? {
        id: release.definition.id,
        version: release.definition.version,
        digest: release.digest,
      }
    : undefined;
  const headers = () => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
  });
  const load = useCallback(
    async function load() {
      const response = await fetch("/api/live", {
        headers: token ? { Authorization: "Bearer " + token } : {},
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (mounted.current) {
        setState(stateSchema.parse(data.snapshot));
        setGoogle(data.google);
      }
    },
    [token],
  );
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => {
      if (mounted.current) setError(e.message);
    });
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => {
    if (!playing || !replay) return;
    const timer = setInterval(
      () =>
        setCursor((c) => {
          if (c >= replay.timeline.length - 1) {
            setPlaying(false);
            return c;
          }
          return c + 1;
        }),
      1200 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, replay, speed]);
  async function work(label: string, fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    voice.cancel();
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function action(body: object, owner = false) {
    const response = await fetch(owner ? "/api/forge" : "/api/live", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    if (data.snapshot) setState(stateSchema.parse(data.snapshot));
    return data.result;
  }
  async function build() {
    await work("Building and proving your capability", async () => {
      const client = await connectSimulator(token, "fixture");
      try {
        const before = (await client.listTools()).tools.map((t) => t.name);
        const built = await client.callTool(
          { name: "forge.create", arguments: { request } },
          undefined,
          { timeout: 120000 },
        );
        if (built.isError)
          throw new Error((built.content as { text: string }[])[0].text);
        const proposal = releaseSchema.parse(
          JSON.parse((built.content as { text: string }[])[0].text),
        );
        setSelected(proposal.digest);
        setReplay(undefined);
        setCapsule(undefined);
        setImportNotice("");
        setTools({
          before,
          after: (await client.listTools()).tools.map((t) => t.name),
        });
        await load();
        setMessage(
          proposal.report.passed
            ? "I built and tested its source. It has zero external authority. Replay your history before approving changes."
            : "This candidate did not earn admission. Inspect the failed checks.",
        );
      } finally {
        await client.close();
      }
    });
  }
  async function runReplay() {
    if (!identity) return;
    await work("Replaying history · every write intercepted", async () => {
      const report = replaySchema.parse(
        await action({ action: "replay", ...identity, connector }),
      );
      setReplay(report);
      setCursor(0);
      setPlaying(true);
      setMessage(
        report.emailsInspected +
          " emails inspected. " +
          report.detectedChanges +
          " deadline changes. " +
          report.effects.length +
          " hypothetical actions. " +
          report.externalWrites +
          " external writes.",
      );
    });
  }
  async function approve() {
    if (!identity) return;
    await work("Saving your approval", async () => {
      await action({ action: "approve", ...identity }, true);
      const client = await connectSimulator(token, "fixture");
      try {
        const after = (await client.listTools()).tools.map((t) => t.name);
        setTools((t) => ({ ...t, after }));
      } finally {
        await client.close();
      }
      setMessage(
        "Installed. Connector write access is still zero. Choose Shadow or approve the exact live permissions below.",
      );
    });
  }
  async function promote(mode: "SHADOW" | "LIVE") {
    if (!identity || !release) return;
    await work("Saving scoped deployment authority", async () => {
      await action({
        action: "promote",
        ...identity,
        connector,
        mode,
        permissions:
          mode === "LIVE"
            ? release.definition.permissions
            : ["calendar.read", "gmail.read"],
      });
      setMessage(
        mode === "SHADOW"
          ? "Shadow observes the same inputs and records proposals. It cannot commit Calendar writes."
          : connector === "google"
            ? "LIVE GOOGLE enabled for your approved Calendar only. Revoke this authority at any time."
            : "Fixture execution enabled. Calendar effects remain synthetic; no Google write is claimed.",
      );
    });
  }
  async function run() {
    if (!release) return;
    await work("Running against connected history", async () => {
      const result = await action({
        action: "run",
        id: release.definition.id,
        connector,
      });
      const report = replaySchema.parse(result.report);
      setReplay(report);
      setCursor(report.timeline.length - 1);
      setPlaying(false);
      setMessage(
        (connector === "google" ? "LIVE GOOGLE" : "FIXTURE") +
          " · " +
          report.mode +
          " · " +
          report.externalWrites +
          " real external writes. " +
          (report.passed
            ? "Execution completed."
            : "Execution failed; inspect the trace."),
      );
    });
  }
  async function exportCapsule() {
    if (!release) return;
    await work("Signing portable software", async () => {
      const response = await fetch("/api/live", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          action: "export",
          id: release.definition.id,
          version: release.definition.version,
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const text = await response.text();
      setCapsule(JSON.parse(text));
      const url = URL.createObjectURL(
        new Blob([text], { type: "application/vnd.forge.capability+json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download =
        release.definition.id + "-" + release.definition.version + ".forgecap";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "Signed by " +
          JSON.parse(text).signature.provider +
          ". Software and test summaries only; no connector tokens or replay data.",
      );
    });
  }
  async function importCapsule(value: unknown) {
    await work("Verifying signature and re-running local tests", async () => {
      const result = await action({ action: "import", capsule: value });
      const imported = releaseSchema.parse(result.release);
      setSelected(imported.digest);
      setReplay(undefined);
      setImportNotice(
        "Signature VALID · Local trust NOT ESTABLISHED · 0 inherited grants",
      );
      setMessage(
        "Software is portable. Trust isn’t. Test this import on your data before granting authority.",
      );
    });
  }
  async function tamper() {
    if (!capsule) return;
    const copy = structuredClone(capsule) as {
      payload: { artifact: { source: string } };
    };
    copy.payload.artifact.source += "\n// tampered copy";
    await importCapsule(copy);
  }
  async function connect(writes: boolean) {
    await work("Opening Google consent", async () => {
      const response = await fetch("/api/live", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ action: "connect", writes }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.location.assign(data.url);
    });
  }
  async function inspectEvidence() {
    if (!release) return;
    await work("Loading evidence", async () => {
      const response = await fetch(
        "/api/live?id=" +
          encodeURIComponent(release.definition.id) +
          "&version=" +
          encodeURIComponent(release.definition.version),
        { headers: headers() },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setAdmission(data.admission);
      setInspect(true);
    });
  }
  const event = replay?.timeline[cursor];
  const signingProvider =
    (capsule as { signature?: { provider?: string } } | undefined)?.signature
      ?.provider ?? "LOCAL DEVELOPMENT";
  return (
    <main className={"forge-live " + (cityArtifact ? "city-artifact" : "")}>
      <header className="live-nav">
        <Link href="/live" className="live-brand">
          <ShieldCheck size={25} /> FORGE <span>LIVE</span>
        </Link>
        <nav>
          <Link href="/world">World</Link>
          <Link href="/studio">Studio</Link>
          <Link href="/capabilities">Tools</Link>
        </nav>
        <button
          className={
            state?.live?.paused ? "pause-control paused" : "pause-control"
          }
          disabled={!!busy}
          onClick={() =>
            void work("Updating global write policy", async () => {
              await action({ action: "pause", paused: !state?.live?.paused });
            })
          }
        >
          {state?.live?.paused ? <Play size={15} /> : <Pause size={15} />}{" "}
          {state?.live?.paused
            ? "Live capabilities paused · Resume"
            : "Pause live capabilities"}
        </button>
      </header>
      <div className="live-wrap">
        <section className="live-intro">
          <div>
            <p className="eyebrow">SOFTWARE AT THE MOMENT OF NEED</p>
            <h1>
              {gallery
                ? "Software is portable.\nTrust isn’t."
                : "Your assistant can build it.\nIt must earn the right to act."}
            </h1>
            <p className="intro-description">
              Describe a goal. Prove the new program against history. Approve
              precisely what it can change.
            </p>
          </div>
          <div className="connector-card">
            <p className="eyebrow">YOUR PROVING GROUND</p>
            <div className="mode-tabs">
              <button
                aria-pressed={connector === "fixture"}
                onClick={() => {
                  setConnector("fixture");
                  setReplay(undefined);
                }}
              >
                FIXTURE
              </button>
              <button
                aria-pressed={connector === "google"}
                onClick={() => {
                  setConnector("google");
                  setReplay(undefined);
                }}
              >
                LIVE GOOGLE
              </button>
            </div>
            <p>
              {connector === "fixture"
                ? "Synthetic, labeled history. Ready immediately. No external credentials or writes."
                : google?.connected
                  ? "Google consent connected. Reads and writes remain capability-scoped."
                  : "Connect your Gmail and a dedicated test Calendar. Server-side consent; encrypted tokens."}
            </p>
            {connector === "google" && (
              <>
                <button disabled={!!busy} onClick={() => void connect(false)}>
                  <Mail size={15} />{" "}
                  {google?.connected
                    ? "Reconnect read access"
                    : "Connect Google read access"}
                </button>
                <button disabled={!!busy} onClick={() => void connect(true)}>
                  <CalendarDays size={15} /> Authorize Calendar writes
                </button>
                <small>
                  {google?.calendarWriteConsent
                    ? "Google write scope granted; FORGE approval still required."
                    : "Calendar writes not authorized in Google consent."}
                </small>
                <a href="#setup">Google setup instructions</a>
              </>
            )}
          </div>
        </section>
        {!gallery && (
          <section className="live-conversation">
            <div className="assistant-avatar">
              <Sparkles size={22} />
            </div>
            <div className="conversation-content">
              <p className="assistant-line" role="status">
                {busy || message}
              </p>
              <label className="sr-only" htmlFor="live-goal">
                Describe your program
              </label>
              <textarea
                id="live-goal"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                disabled={!!busy || voice.active}
              />
              <div className="conversation-actions">
                <span>
                  <ShieldCheck size={14} /> Zero authority until you approve
                </span>
                <button
                  aria-label={
                    voice.active ? "Stop voice input" : "Use voice input"
                  }
                  aria-pressed={voice.active}
                  disabled={!!busy || voice.status === "stopping"}
                  onClick={() => void voice.toggle(request)}
                >
                  <Mic size={16} />
                </button>
                <button
                  className="primary"
                  disabled={
                    !state ||
                    !!busy ||
                    voice.active ||
                    request.trim().length < 5
                  }
                  onClick={() => void build()}
                >
                  Build this program <ArrowRight size={16} />
                </button>
              </div>
              {voice.message && <p role="status">{voice.message}</p>}
            </div>
          </section>
        )}
        {error && (
          <div className="live-error" role="alert">
            <ShieldCheck size={20} />
            <div>
              <strong>
                {/capsule/i.test(error) ? "CAPSULE REJECTED" : "Action stopped"}
              </strong>
              <p>{error}</p>
            </div>
          </div>
        )}
        {state?.live?.paused && (
          <p className="live-error">
            Global pause is active. The broker denies live writes and scheduled
            dispatch.
          </p>
        )}
        {cityArtifact && (
          <section className="portable-city-review">
            <p className="eyebrow">PORTABLE ENVIRONMENT ALGORITHM</p>
            <h2>
              {release.definition.name} v{release.definition.version}
            </h2>
            <p>
              This City algorithm uses the same registry, isolated worker and
              broker. Capsule signatures convey software identity; they never
              confer City authority. Imported software requires fresh local
              Futures and owner approval.
            </p>
            <code>{release.digest}</code>
            {trust?.imported && !release.futures && (
              <button
                type="button"
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  void work("Evaluating imported City software", async () => {
                    if (!application)
                      throw new Error("FORGE application required");
                    await application.command({
                      action: "review-import",
                      digest: release.digest,
                    });
                    setMessage(
                      "Fresh local Futures started. Open World to review measured results and request owner admission.",
                    );
                  })
                }
              >
                Run local City Futures
              </button>
            )}
            <Link href="/">Open City admission and Futures</Link>
          </section>
        )}
        <div className="live-columns">
          <section className="live-proof">
            <div className="section-heading">
              <div>
                <p className="eyebrow">PROVE BEFORE YOU PERMIT</p>
                <h2>Replay</h2>
              </div>
              <span className="mode-badge">
                {replay?.connector === "google"
                  ? "LIVE GOOGLE"
                  : connector === "google"
                    ? "GOOGLE SELECTED"
                    : "FIXTURE"}{" "}
                · {replay?.mode ?? "REPLAY"}
              </span>
            </div>
            <p className="section-description">
              A rehearsal against history. Every proposed write is intercepted
              before it reaches a service.
            </p>
            {replay ? (
              <>
                <div className="replay-stats">
                  <div>
                    <strong>{replay.emailsInspected}</strong>
                    <span>emails inspected</span>
                  </div>
                  <div>
                    <strong>{replay.calendarEventsEvaluated}</strong>
                    <span>events evaluated</span>
                  </div>
                  <div>
                    <strong>{replay.detectedChanges}</strong>
                    <span>deadline changes</span>
                  </div>
                  <div
                    className={
                      replay.externalWrites ? "real-write" : "zero-write"
                    }
                  >
                    <strong>{replay.externalWrites}</strong>
                    <span>external writes</span>
                  </div>
                </div>
                <div className="playback">
                  <button
                    aria-label={playing ? "Pause replay" : "Play replay"}
                    onClick={() => {
                      if (cursor >= replay.timeline.length - 1) setCursor(0);
                      setPlaying(!playing);
                    }}
                  >
                    {playing ? <Pause size={17} /> : <Play size={17} />}
                  </button>
                  <label>
                    Playback{" "}
                    <select
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      <option value={1}>1×</option>
                      <option value={3}>3×</option>
                      <option value={8}>8×</option>
                    </select>
                  </label>
                  <span>
                    {cursor + 1} / {replay.timeline.length} recorded events
                  </span>
                </div>
                <div className="replay-timeline">
                  {replay.timeline.map((item, i) => (
                    <button
                      key={item.executionId}
                      className={
                        "timeline-event " +
                        (i === cursor ? "selected " : "") +
                        (i > cursor ? "upcoming " : "")
                      }
                      onClick={() => {
                        setCursor(i);
                        setPlaying(false);
                      }}
                    >
                      <span className={"timeline-dot " + item.status} />
                      <time>{item.at.slice(5, 10)}</time>
                      <span>{item.label}</span>
                      <b>
                        {item.status === "changed"
                          ? "Change detected"
                          : item.status === "ignored"
                            ? "No action"
                            : "Blocked / failed"}
                      </b>
                    </button>
                  ))}
                </div>
                {event && (
                  <div className="effect-inspector">
                    <p className="eyebrow">{event.label}</p>
                    {event.effectIndexes.length ? (
                      event.effectIndexes.map((i) => {
                        const effect = replay.effects[i];
                        return (
                          <div key={i}>
                            <CalendarDays size={18} />
                            <div>
                              <strong>{effect.title}</strong>
                              <p>
                                {effect.operation}{" "}
                                {effect.date ? "· " + effect.date : ""}
                              </p>
                            </div>
                            <span>{effect.disposition}</span>
                            {effect.link && (
                              <a
                                href={effect.link}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open Calendar
                              </a>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <p>No Calendar change proposed for this event.</p>
                    )}
                  </div>
                )}
                {replay.evaluation ? (
                  <p className="evaluation-note">
                    <Check size={15} /> Labeled fixture:{" "}
                    {replay.evaluation.exactMatches}/{replay.evaluation.cases}{" "}
                    exact matches · Precision{" "}
                    {replay.evaluation.precision?.toFixed(2) ?? "N/A"} · Recall{" "}
                    {replay.evaluation.recall?.toFixed(2) ?? "N/A"}
                  </p>
                ) : (
                  <p className="evaluation-note">
                    Observed counts from authorized history. No accuracy score
                    is claimed without ground-truth labels.
                  </p>
                )}
              </>
            ) : (
              <div className="replay-empty">
                <div className="empty-flow">
                  <Mail />
                  <ArrowRight />
                  <Search />
                  <ArrowRight />
                  <CalendarDays />
                </div>
                <h3>See what it would have done.</h3>
                <p>
                  Read history → detect changes → record hypothetical effects.
                  <br />
                  Your real Calendar remains untouched during replay.
                </p>
                <button
                  className="primary"
                  disabled={!!busy || !release?.report.passed}
                  onClick={() => void runReplay()}
                >
                  Run Replay <Play size={15} />
                </button>
              </div>
            )}
            {replay && (
              <button
                disabled={!!busy || !release}
                onClick={() => void runReplay()}
              >
                Replay again · intercept all writes
              </button>
            )}
          </section>
          <aside className="live-authority">
            <p className="eyebrow">PROGRESSIVE TRUST</p>
            <h2>{release?.definition.name ?? "No capability yet"}</h2>
            <p>
              {release
                ? "v" +
                  release.definition.version +
                  " · " +
                  (trust?.imported ? "IMPORTED" : "LOCAL")
                : "Build a capability to begin."}
            </p>
            {release && (
              <p className="compiler-provenance" title={release.usage.model}>
                {release?.usage.requestIds?.length
                  ? "LIVE AWS · Amazon Bedrock compilation"
                  : trust?.imported
                    ? "IMPORTED · local retesting"
                    : release
                      ? "FIXTURE · deterministic compilation"
                      : ""}
              </p>
            )}
            <ol className="trust-ladder">
              {[
                "GENERATED",
                "SANDBOXED",
                "TESTED",
                "REPLAYED",
                "SECURITY_VERIFIED",
                "HUMAN_APPROVED",
                "SHADOW",
                "LIVE",
              ].map((stage) => (
                <li
                  key={stage}
                  className={
                    trust?.stages.some((s) => s.stage === stage) ? "earned" : ""
                  }
                >
                  <span>
                    {trust?.stages.some((s) => s.stage === stage) ? (
                      <Check size={13} />
                    ) : (
                      ""
                    )}
                  </span>
                  {stage.replaceAll("_", " ")}
                </li>
              ))}
            </ol>
            <div className="current-trust">
              Current authority{" "}
              <strong>{trust?.current.replaceAll("_", " ") ?? "NONE"}</strong>
              <small>
                {trust?.grants.length ?? 0} active permission grants
              </small>
            </div>
            {release && (
              <>
                <div className="permission-delta">
                  <p className="eyebrow">EXACT LIVE PERMISSION DELTA</p>
                  {release.definition.permissions.map((p) => (
                    <div key={p}>
                      <code>{p}</code>
                      <span>
                        {trust?.grants.some((g) => g === p)
                          ? "ALLOW"
                          : p === "calendar.write"
                            ? "REQUEST"
                            : "NOT GRANTED"}
                      </span>
                    </div>
                  ))}
                  <div>
                    <code>email.send</code>
                    <span>DENY</span>
                  </div>
                </div>
                <div className="authority-actions">
                  <button
                    disabled={
                      !!busy || !trust?.replayId || release.status !== "review"
                    }
                    onClick={() => void approve()}
                  >
                    Approve tested program
                  </button>
                  <button
                    disabled={!!busy || release.status !== "installed"}
                    onClick={() => void promote("SHADOW")}
                  >
                    Enable Shadow · no writes
                  </button>
                  <button
                    className="primary"
                    disabled={!!busy || release.status !== "installed"}
                    onClick={() => void promote("LIVE")}
                  >
                    Approve exact permissions ·{" "}
                    {connector === "google" ? "LIVE GOOGLE" : "FIXTURE"}
                  </button>
                  <button
                    disabled={
                      !!busy ||
                      !["LIVE", "SHADOW"].includes(trust?.current ?? "")
                    }
                    onClick={() => void run()}
                  >
                    <Play size={15} /> Run{" "}
                    {trust?.current === "SHADOW"
                      ? "Shadow"
                      : connector === "google"
                        ? "LIVE GOOGLE"
                        : "Fixture"}
                  </button>
                  <button
                    disabled={
                      !!busy ||
                      !["LIVE", "SHADOW"].includes(trust?.current ?? "")
                    }
                    onClick={() =>
                      void work("Saving persistent trigger", async () => {
                        await action({
                          action: "schedule",
                          id: release.definition.id,
                          everySeconds: 300,
                          enabled:
                            !state?.live?.schedules[release.digest]?.enabled,
                        });
                      })
                    }
                  >
                    {state?.live?.schedules[release.digest]?.enabled
                      ? "Disable"
                      : "Enable"}{" "}
                    five-minute polling
                  </button>
                  <button
                    className="revoke"
                    disabled={!!busy || !trust?.grants.length}
                    onClick={() =>
                      void work(
                        "Revoking every version’s authority",
                        async () => {
                          await action({
                            action: "revoke",
                            id: release.definition.id,
                          });
                          setMessage(
                            "Live access revoked in the broker. Scheduled polling is disabled.",
                          );
                        },
                      )
                    }
                  >
                    Revoke live access
                  </button>
                </div>
                <button
                  className="inspect-button"
                  disabled={!!busy}
                  onClick={() => void inspectEvidence()}
                >
                  <Search size={15} /> Inspect FORGE
                </button>
              </>
            )}
          </aside>
        </div>
        <section className="capsule-section" id="capsules">
          <div>
            <p className="eyebrow">CAPABILITY CAPSULES</p>
            <h2>
              Share the software.
              <br />
              Keep authority personal.
            </h2>
            <p>
              A signed .forgecap carries source, contracts, tests and
              provenance. It carries zero connector grants.
            </p>
            <span className="mode-badge">{signingProvider} SIGNING</span>
          </div>
          <div className="capsule-actions">
            <button
              className="primary"
              disabled={!!busy || !release?.report.passed}
              onClick={() => void exportCapsule()}
            >
              <Download size={17} /> Export .forgecap
            </button>
            <label className="file-button">
              <Upload size={17} /> Import .forgecap
              <input
                type="file"
                accept=".forgecap,application/json"
                disabled={!!busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (file.size > 65536) {
                    setError("Capsule size budget exceeded");
                    return;
                  }
                  try {
                    await importCapsule(JSON.parse(await file.text()));
                  } catch {
                    setError("Invalid capsule JSON");
                  }
                }}
              />
            </label>
            <button
              disabled={!!busy || !capsule}
              onClick={() => void importCapsule(capsule)}
            >
              <Package size={17} /> Import exported copy · fresh local trust
            </button>
            <button disabled={!!busy || !capsule} onClick={() => void tamper()}>
              <ShieldCheck size={17} /> Test tampered copy
            </button>
            {importNotice && (
              <p className="import-notice" role="status">
                {importNotice}
              </p>
            )}
          </div>
        </section>
        <section className="capability-gallery">
          <p className="eyebrow">YOUR CAPABILITIES</p>
          <div>
            {state?.releases
              .filter((r) => r.status === "installed" || r.status === "review")
              .map((r) => (
                <button
                  key={r.digest}
                  className={r.digest === release?.digest ? "selected" : ""}
                  onClick={() => {
                    setSelected(r.digest);
                    setReplay(
                      state.live?.replays.find(
                        (p) => p.id === state.live?.trust[r.digest]?.replayId,
                      ),
                    );
                  }}
                >
                  <Package size={22} />
                  <strong>{r.definition.name}</strong>
                  <span>
                    v{r.definition.version} ·{" "}
                    {state.live?.trust[r.digest]?.imported
                      ? "IMPORTED"
                      : "LOCAL"}
                  </span>
                  <small>
                    {r.definition.executable?.interface === "city/v1"
                      ? "DIGITAL TWIN / " +
                        (state.live?.trust[r.digest]?.current ??
                          "ZERO AUTHORITY")
                      : r.definition.executable
                        ? (state.live?.trust[r.digest]?.connector === "google"
                            ? "LIVE GOOGLE"
                            : "FIXTURE") +
                          " · " +
                          (state.live?.trust[r.digest]?.current ??
                            "ZERO AUTHORITY")
                        : "SIMULATION ONLY"}
                  </small>
                </button>
              ))}
          </div>
        </section>
        <details className="live-setup" id="setup">
          <summary>Google Live setup and server access</summary>
          <p>
            Enable Gmail and Calendar APIs in Google Cloud. Configure a Web
            OAuth client and test user. Keep its secret in server-only
            .env.local.
          </p>
          <pre>
            {
              "GOOGLE_CLIENT_ID=your-web-client-id\nGOOGLE_CLIENT_SECRET=your-private-secret\nGOOGLE_REDIRECT_URI=http://127.0.0.1:3108/api/google/callback\nGOOGLE_CALENDAR_ID=dedicated-test-calendar-id\nGOOGLE_TRUSTED_SENDERS=approved-professor-address"
            }
          </pre>
          <p>
            Register the exact redirect URI. Restart, connect read access,
            replay, authorize Calendar writes, replay after reconnecting, then
            approve the program and exact permissions. Use an email subject
            matching an all-day event title and body “Deadline changed to
            YYYY-MM-DD”. Sender must match your allowlist.
          </p>
          <p>
            Google snapshots are transient. Summaries and traces withhold email
            and Calendar contents. Bedrock receives your goal, not your mailbox.
            Complete instructions: docs/GOOGLE.md.
          </p>
          <label>
            Server API token (optional)
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <button onClick={() => void work("Refreshing owner access", load)}>
            Refresh access
          </button>
          <button
            disabled={!!busy}
            onClick={() =>
              void work("Deleting historical evidence", async () => {
                await action({ action: "delete_evidence" });
                setReplay(undefined);
              })
            }
          >
            Delete replay evidence and revoke grants
          </button>
          <button
            disabled={!!busy || !google?.connected}
            onClick={() =>
              void work("Disconnecting Google", async () => {
                await action({ action: "disconnect" });
                await load();
              })
            }
          >
            Disconnect Google
          </button>
        </details>
        <footer>
          We do not trust AI-generated software. We make it earn trust.
        </footer>
      </div>
      {inspect && (
        <EvidenceDialog close={() => setInspect(false)}>
          <div className="section-heading">
            <h2>Inspect FORGE</h2>
            <button onClick={() => setInspect(false)}>Close</button>
          </div>
          <p>
            Actual compiler, checks, local trust, replay and execution evidence.
            Signing: {signingProvider}.
          </p>
          <h3>MCP tools · before / after installation</h3>
          <div className="tool-comparison">
            <pre>
              {tools.before.join("\n") || "Build a capability to capture T0."}
            </pre>
            <pre>{tools.after.join("\n") || "No T1 capture yet."}</pre>
          </div>
          <h3>Admission report</h3>
          <pre>{JSON.stringify(admission, null, 2)}</pre>
          <h3>Source program</h3>
          <pre>
            {release?.definition.executable?.source ??
              release?.artifacts.program}
          </pre>
          <h3>Latest execution trace</h3>
          <pre>
            {JSON.stringify(
              [...(state?.executions ?? [])]
                .reverse()
                .find((e) => e.capabilityId === release?.definition.id),
              null,
              2,
            )}
          </pre>
        </EvidenceDialog>
      )}
    </main>
  );
}
function EvidenceDialog({
  close,
  children,
}: {
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="live-inspect-overlay"
      aria-label="Inspect FORGE evidence"
      onCancel={close}
    >
      <section>{children}</section>
    </dialog>
  );
}
