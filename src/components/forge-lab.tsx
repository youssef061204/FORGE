"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForgeApplication } from "./forge-application";
import { useVoiceInput } from "./use-voice-input";
import { CityCanvas } from "./city-canvas";
import { approvalCode } from "./approval-phrase";
import type { CityLab } from "@/forge/city-lab";
import type { Candidate, FutureFrame } from "@/forge/city-contracts";
type LabSnapshot = Awaited<ReturnType<CityLab["snapshot"]>>;
const sections = ["Voice", "Rehearsal", "Evidence", "Time", "Arena"] as const;
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
export function ForgeLab() {
  const app = useForgeApplication();
  const [lab, setLab] = useState<LabSnapshot>(),
    [section, setSection] = useState<(typeof sections)[number]>("Voice");
  const [message, setMessage] = useState(
      "Choose a test for the current program.",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<{
    code: string;
    expiresAt: number;
    digest: string;
  }>();
  const [confirmation, setConfirmation] = useState(""),
    [checkpointName, setCheckpointName] = useState("Before the storm");
  const [operation, setOperation] = useState("population.route"),
    [selectedDigest, setSelectedDigest] = useState("");
  const [briefing, setBriefing] = useState(""),
    [speaking, setSpeaking] = useState(false);
  const armedRef = useRef(armed),
    speech = useRef<SpeechSynthesisUtterance | undefined>(undefined);
  useEffect(() => {
    armedRef.current = armed;
  }, [armed]);
  const headers = useCallback(
    (): Record<string, string> =>
      app.token ? { Authorization: "Bearer " + app.token } : {},
    [app.token],
  );
  const refresh = useCallback(async () => {
    const response = await fetch("/api/lab", {
        headers: headers(),
        cache: "no-store",
      }),
      value = await response.json();
    if (!response.ok) throw new Error(value.error);
    setLab(value);
  }, [headers]);
  useEffect(() => {
    let active = true,
      loading = false;
    const load = async () => {
      if (loading || !active) return;
      loading = true;
      try {
        await refresh();
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Lab unavailable");
      } finally {
        loading = false;
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
      window.speechSynthesis?.cancel();
    };
  }, [refresh]);
  async function command(data: Record<string, unknown>) {
    const response = await fetch("/api/lab", {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    await refresh();
    return value;
  }
  async function perform(data: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    try {
      const value = await command(data);
      setMessage(success);
      return value;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  const voice = useVoiceInput(setConfirmation, (text) => {
    if (armedRef.current && approvalCode(text)) void confirm(text.trim());
  });
  async function confirm(text: string) {
    const code = approvalCode(text);
    if (!code || code.length !== 6) {
      setError("Say or type confirm followed by the six digits.");
      return;
    }
    if (!armedRef.current) {
      setError("Arm a reviewed artifact first.");
      return;
    }
    armedRef.current = undefined;
    setArmed(undefined);
    voice.cancel();
    await perform(
      { action: "confirm", code },
      "Exact artifact approved and invoked. The challenge is consumed.",
    );
  }
  const latest = app.snapshot?.contests.at(-1),
    city = app.snapshot?.city;
  const artifacts =
    app.snapshot?.releases.filter(
      (r) =>
        r.definition.executable?.interface === "city/v1" && r.report.passed,
    ) ?? [];
  const digest =
    artifacts.find((r) => r.digest === selectedDigest)?.digest ??
    latest?.releaseDigest ??
    artifacts.at(-1)?.digest;
  const running = lab?.reports.some((r) => r.status === "running");
  async function narrate() {
    const result = await perform(
      { action: "briefing" },
      "Briefing generated from current measured state.",
    );
    if (!result) return;
    setBriefing(result.text);
    if (!("speechSynthesis" in window)) {
      setError(
        "Speech output unavailable in this browser. The measured transcript is shown.",
      );
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(result.text);
    speech.current = utterance;
    utterance.lang = "en-US";
    utterance.rate = 1.03;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      setError("Browser narration failed; read the measured transcript.");
    };
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }
  return (
    <main className={"forge-lab" + (section === "Arena" ? " lab-arena" : "")}>
      <header className="lab-heading">
        <div>
          <span className="eyebrow">INSPECT FORGE</span>
          <h1>Program tests</h1>
          <p>
            A voice-first MCP simulator with measured evidence. Native Alexa+
            preview access is not claimed.
          </p>
        </div>
      </header>
      <nav className="lab-tabs" aria-label="Lab sections">
        {sections.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={section === s}
            onClick={() => {
              voice.cancel();
              setSection(s);
            }}
          >
            {s}
          </button>
        ))}
      </nav>
      <p className={error ? "lab-error" : "lab-message"} aria-live="polite">
        {error || message}
      </p>
      {section === "Voice" && (
        <div className="lab-grid">
          <section className="lab-card">
            <span className="eyebrow">01 / MISSION MEMORY</span>
            <h2>Mission history</h2>
            <p>
              Use the persistent composer with mission memory enabled. Follow-up
              requests include the previous owner goal and constraints in the
              actual compilation context.
            </p>
            <ol>
              {lab?.missions
                .slice()
                .reverse()
                .map((m) => (
                  <li key={m.contestId}>
                    <small>
                      {m.followUp ? "FOLLOW-UP" : "NEW MISSION"} /{" "}
                      {new Date(m.at).toLocaleTimeString()}
                    </small>
                    <p>{m.request}</p>
                  </li>
                ))}
            </ol>
            {!lab?.missions.length && (
              <p>No missions yet. Submit a goal from the conversation.</p>
            )}
          </section>
          <section className="lab-card">
            <span className="eyebrow">02 / SPOKEN APPROVAL CHALLENGE</span>
            <h2>Spoken approval</h2>
            <p>
              Arm the exact reviewed digest, then say “confirm” and the six
              digits. The challenge expires in 60 seconds and is consumed after
              one attempt. Voice identity is not verified.
            </p>
            <code>{latest?.releaseDigest ?? "No reviewed artifact"}</code>
            <button
              type="button"
              disabled={
                busy || latest?.status !== "review" || !latest.releaseDigest
              }
              onClick={() => {
                void perform(
                  {
                    action: "arm",
                    contestId: latest!.id,
                    digest: latest!.releaseDigest,
                  },
                  "Owner challenge armed.",
                ).then((value) => {
                  if (value) {
                    setArmed(value);
                    armedRef.current = value;
                    setConfirmation("");
                  }
                });
              }}
            >
              Arm spoken approval
            </button>
            {armed && (
              <div className="approval-code">
                <strong>{armed.code}</strong>
                <small>
                  Expires {new Date(armed.expiresAt).toLocaleTimeString()} /
                  digest {armed.digest.slice(0, 16)}
                </small>
              </div>
            )}
            <label>
              Approval phrase
              <input
                aria-label="Approval phrase"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="confirm 123456"
              />
            </label>
            <div className="lab-actions">
              <button
                type="button"
                disabled={!armed || busy}
                onClick={() => {
                  void voice.toggle("");
                }}
              >
                {voice.active ? "Stop approval microphone" : "Speak approval"}
              </button>
              <button
                type="button"
                disabled={!armed || busy}
                onClick={() => {
                  void confirm(confirmation);
                }}
              >
                Confirm approval
              </button>
            </div>
            <small>{voice.message}</small>
          </section>
          <section className="lab-card">
            <span className="eyebrow">03 / MEASURED VOICE BRIEFING</span>
            <h2>City briefing</h2>
            <p>
              Narrates live metrics, deployed version and sampling limits using
              your browser’s speech synthesis. Requires your click; this is not
              an Alexa or Polly voice.
            </p>
            <div className="lab-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void narrate();
                }}
              >
                Narrate current briefing
              </button>
              <button
                type="button"
                disabled={!speaking}
                onClick={() => {
                  window.speechSynthesis?.cancel();
                  setSpeaking(false);
                }}
              >
                Stop narration
              </button>
            </div>
            {briefing && <blockquote>{briefing}</blockquote>}
          </section>
        </div>
      )}
      {section === "Rehearsal" && (
        <div className="lab-grid">
          <section className="lab-card">
            <span className="eyebrow">04 / WHAT-IF REHEARSAL</span>
            <h2>Compare a change</h2>
            <p>
              20 paired seeded trials compare this policy under current weather
              and severe storm weather, in isolated forks.
            </p>
            <label>
              Tested program
              <select
                aria-label="Tested program"
                value={digest ?? ""}
                onChange={(e) => setSelectedDigest(e.target.value)}
              >
                {artifacts.map((r) => (
                  <option key={r.digest} value={r.digest}>
                    {r.definition.name} v{r.definition.version}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!digest || busy || running}
              onClick={() => {
                void perform(
                  {
                    action: "experiment",
                    kind: "what-if",
                    digest,
                    change: { operation: "weather.set", rain: 0.95, wind: 0.9 },
                  },
                  "What-if rehearsal started: 20 real paired trials. Current City unchanged.",
                );
              }}
            >
              Rehearse severe storm
            </button>
          </section>
          <section className="lab-card">
            <span className="eyebrow">STRESS TEST</span>
            <h2>Test severe conditions</h2>
            <p>
              Wildfire, blackout, flood with every bridge closed, and
              earthquake. Five paired trials per category expose execution
              failures and hard-constraint violations.
            </p>
            <button
              disabled={!digest || busy || running}
              onClick={() => {
                void perform(
                  { action: "experiment", kind: "chaos", digest },
                  "Stress Test started.",
                );
              }}
            >
              Run Stress Test
            </button>
          </section>
          <section className="lab-card">
            <span className="eyebrow">06 / CAUSAL POLICY COMPARISON</span>
            <h2>What mattered</h2>
            <p>
              Run the same source and seeds with one action family suppressed in
              Futures only. Report the measured loss delta; this is a controlled
              simulator intervention.
            </p>
            <label>
              Suppress action
              <select
                aria-label="Suppress action"
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
              >
                {[
                  "population.route",
                  "shelter.activate",
                  "signal.set",
                  "grid.shed",
                  "vehicle.dispatch",
                  "road.close",
                ].map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
            <button
              disabled={!digest || busy || running}
              onClick={() => {
                void perform(
                  { action: "experiment", kind: "ablation", digest, operation },
                  "Action ablation started: 20 paired trials of the actual source.",
                );
              }}
            >
              Measure action contribution
            </button>
          </section>
          <section className="lab-card lab-wide">
            <h2>Measured experiment ledger</h2>
            <p>
              Lower loss is better. Positive delta means the intervention
              performed worse. Denied actions remain failures; they are never
              reported as successful execution.
            </p>
            {lab?.reports
              .slice()
              .reverse()
              .map((report) => (
                <div className="lab-report" key={report.id}>
                  <strong>
                    {report.kind.toUpperCase()} / {report.status} /{" "}
                    {report.rows.length}/20 paired trials
                  </strong>
                  <small>
                    Source {report.sourceDigest.slice(0, 16)} / snapshot{" "}
                    {report.snapshotHash.slice(0, 16)} / current City unchanged
                  </small>
                  {report.error && <p>{report.error}</p>}
                  <table>
                    <thead>
                      <tr>
                        <th>Scenario</th>
                        <th>Seed</th>
                        <th>Base loss</th>
                        <th>Test loss</th>
                        <th>Delta</th>
                        <th>Failures</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.scenario}</td>
                          <td>{r.seed}</td>
                          <td>{r.baseline.score.toFixed(3)}</td>
                          <td>{r.treatment.score.toFixed(3)}</td>
                          <td>{r.lossDelta.toFixed(3)}</td>
                          <td>
                            {r.treatment.error ||
                              r.treatment.violations.join("; ") ||
                              "none sampled"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    type="button"
                    onClick={() =>
                      download(report, "forge-" + report.kind + ".json")
                    }
                  >
                    Export measured results
                  </button>
                </div>
              ))}
          </section>
        </div>
      )}
      {section === "Evidence" && (
        <div className="lab-grid">
          <section className="lab-card">
            <span className="eyebrow">CONFIDENCE</span>
            <h2>Observed failure rate</h2>
            <p>
              95% Wilson intervals expose the limits of a small sample. Assumes
              independent draws from this simulator’s scenario distribution; it
              says nothing about an unmodeled real city.
            </p>
            {lab?.uncertainty.map((c) => (
              <div className="uncertainty-row" key={c.id}>
                <strong>{c.name}</strong>
                <p>
                  {c.interval.failures}/{c.interval.samples} failures sampled /
                  interval {(100 * c.interval.lower).toFixed(1)}–
                  {(100 * c.interval.upper).toFixed(1)}%
                </p>
                <div className="uncertainty-bar">
                  <i
                    style={{
                      left: c.interval.lower * 100 + "%",
                      width: (c.interval.upper - c.interval.lower) * 100 + "%",
                    }}
                  />
                </div>
              </div>
            ))}
          </section>
          <section className="lab-card">
            <span className="eyebrow">EVIDENCE</span>
            <h2>Signed test record</h2>
            <p>
              Ed25519 binds the goal, source, snapshot, seed set and results
              hashes to the program digest and provider request IDs. Excludes
              raw goals, City snapshots and authority. Local signing;
              independently verify the issuer fingerprint.
            </p>
            <button
              type="button"
              disabled={!latest?.releaseDigest || busy}
              onClick={() => {
                void perform(
                  { action: "passport", contestId: latest!.id },
                  "Passport signature verified; download includes its public key and hashes.",
                ).then((value) => {
                  if (value)
                    download(value.passport, "forge-evidence-passport.json");
                });
              }}
            >
              Download Evidence
            </button>
          </section>
        </div>
      )}
      {section === "Time" && (
        <div className="lab-grid">
          <section className="lab-card">
            <span className="eyebrow">09 / SAFE TIME MACHINE</span>
            <h2>Restore a checkpoint</h2>
            <p>
              Three bounded owner checkpoints. Restoration pauses the City and
              revokes every City grant. It never rewinds Google or restores
              approval. Futures admission still applies to current state without
              automatic rewind.
            </p>
            <label>
              Checkpoint name
              <input
                aria-label="Checkpoint name"
                value={checkpointName}
                onChange={(e) => setCheckpointName(e.target.value)}
                maxLength={60}
              />
            </label>
            <button
              disabled={busy || !checkpointName.trim()}
              onClick={() => {
                void perform(
                  { action: "checkpoint", name: checkpointName },
                  "Owner checkpoint saved without authority.",
                );
              }}
            >
              Save City checkpoint
            </button>
            {lab?.checkpoints
              .slice()
              .reverse()
              .map((c) => (
                <div className="lab-report" key={c.id}>
                  <strong>{c.name}</strong>
                  <small>
                    Revision {c.revision} / {new Date(c.at).toLocaleString()} /{" "}
                    {c.hash.slice(0, 16)}
                  </small>
                  <button
                    disabled={busy}
                    onClick={() => {
                      void perform(
                        { action: "restore", id: c.id },
                        "Checkpoint restored. All City authority revoked; simulation paused. External services untouched.",
                      );
                    }}
                  >
                    Restore & revoke City authority
                  </button>
                </div>
              ))}
          </section>
        </div>
      )}
      {section === "Arena" && (
        <section className="lab-card">
          <span className="eyebrow">10 / PAIRED FUTURES ARENA</span>
          <h2>Compare programs</h2>
          <p>
            Two actual recorded branches synchronized by seed and simulation
            time. Displays complete recorded road/building/signal state and a
            representative subset of 18 vehicles and 18 pedestrians per frame.
          </p>
          {city && latest?.candidates.length ? (
            <FuturesArena city={city} candidates={latest.candidates} />
          ) : (
            <p>Build a City goal to record option Futures.</p>
          )}
        </section>
      )}
    </main>
  );
}
function FuturesArena({
  city,
  candidates,
}: {
  city: NonNullable<ReturnType<typeof useForgeApplication>["snapshot"]>["city"];
  candidates: Candidate[];
}) {
  const [leftId, setLeft] = useState(""),
    [rightId, setRight] = useState(""),
    [seedIndex, setSeed] = useState(0),
    [timeIndex, setTime] = useState(0);
  const left = candidates.find((c) => c.id === leftId) ?? candidates[0],
    right = candidates.find((c) => c.id === rightId) ?? candidates[1] ?? left;
  const seeds = [
    ...new Set(
      left.frames
        .map((f) => f.seed)
        .filter((s): s is number => s !== undefined),
    ),
  ].filter((seed) => right.frames.some((f) => f.seed === seed));
  const seed = seeds[seedIndex % Math.max(1, seeds.length)],
    leftFrames = left.frames.filter((f) => f.seed === seed),
    rightFrames = right.frames.filter((f) => f.seed === seed);
  const times = leftFrames
      .map((f) => f.seconds)
      .filter((t) => rightFrames.some((f) => f.seconds === t)),
    time = times[timeIndex % Math.max(1, times.length)];
  const frameLeft = leftFrames.find((f) => f.seconds === time),
    frameRight = rightFrames.find((f) => f.seconds === time);
  const select = (value: string, setter: (v: string) => void) => {
    setter(value);
    setSeed(0);
    setTime(0);
  };
  const noop = () => {};
  function branch(
    candidate: Candidate,
    frame: FutureFrame | undefined,
    setter: (v: string) => void,
    label: string,
  ) {
    const outcome = candidate.rollouts.find((r) => r.seed === seed);
    return (
      <div
        className="arena-side"
        data-seed={frame?.seed}
        data-seconds={frame?.seconds}
      >
        <label>
          {label}
          <select
            aria-label={label + " candidate"}
            value={candidate.id}
            onChange={(e) => select(e.target.value, setter)}
          >
            {candidates.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {frame ? (
          <div className="arena-canvas">
            <CityCanvas
              city={city}
              branch={frame}
              readOnly
              label={label + " recorded future"}
              demo
              onSelect={noop}
              onPause={noop}
              onInspector={noop}
            />
          </div>
        ) : (
          <p>No matching recorded frame.</p>
        )}
        <p>
          Paired terminal loss {outcome?.score.toFixed(3) ?? "--"} / exposed{" "}
          {frame?.metrics.exposedPeople ?? "--"} / hospital{" "}
          {Math.round((frame?.metrics.hospitalPower ?? 0) * 100)}%
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="arena-controls">
        <label>
          Paired seed
          <select
            aria-label="Paired seed"
            value={seedIndex}
            onChange={(e) => {
              setSeed(Number(e.target.value));
              setTime(0);
            }}
          >
            {seeds.map((s, i) => (
              <option value={i} key={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          Recorded time {time ?? "--"}s
          <input
            aria-label="Arena recorded time"
            type="range"
            min={0}
            max={Math.max(0, times.length - 1)}
            value={timeIndex}
            onChange={(e) => setTime(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="arena-grid">
        {branch(left, frameLeft, setLeft, "Left")}
        {branch(right, frameRight, setRight, "Right")}
      </div>
    </>
  );
}
