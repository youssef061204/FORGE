import { randomUUID } from "node:crypto";
import { digest } from "./hash";
import { historySchema, type Replay } from "./live-contracts";
import type { Connector } from "./connectors";
import type { Release, Execution } from "./records";
import type { StateStore } from "./store";
import type { Sandbox } from "./sandbox";
import type { LiveContext } from "./live-broker";
import { replayLabels } from "./replay-fixtures";

export async function replayCapability(
  release: Release,
  connector: Connector,
  store: StateStore,
  sandbox: Sandbox,
  mode: Replay["mode"] = "REPLAY",
) {
  const history = historySchema.parse(await connector.snapshot());
  const processed = (await store.read()).live?.processed ?? {};
  const processedKey = (emailId: string) =>
    digest({ id: release.definition.id, binding: connector.binding, emailId });
  if (mode !== "REPLAY")
    history.emails = history.emails.filter(
      (email) => !processed[processedKey(email.id)],
    );
  const context: LiveContext = { mode, connector, history, effects: [] };
  const report: Replay = {
    id: randomUUID(),
    digest: release.digest,
    mode,
    connector: connector.mode,
    binding: connector.binding,
    at: new Date().toISOString(),
    from: history.from,
    to: history.to,
    emailsInspected: history.emails.length,
    calendarEventsEvaluated: history.events.length,
    detectedChanges: 0,
    externalWrites: 0,
    blockedActions: 0,
    passed: true,
    effects: context.effects,
    timeline: [],
  };
  const executions: Execution[] = [];
  let exact = 0,
    tp = 0,
    fp = 0,
    fn = 0;
  for (const email of history.emails) {
    const before = context.effects.length;
    context.moduleOutput = undefined;
    const execution = await sandbox.run(
      release.definition,
      {
        id: `${report.id}-${digest(email.id).slice(0, 16)}`,
        type: release.definition.trigger,
        payload: { text: "Authorized historical event", email },
      },
      store,
      undefined,
      context,
    );
    executions.push(execution);
    if (mode === "LIVE" && execution.status === "success")
      await store.transaction((s) => {
        if (s.live)
          s.live.processed[processedKey(email.id)] = new Date().toISOString();
      });
    const observed = (context as LiveContext).moduleOutput;
    const change = observed?.change;
    if (change) report.detectedChanges++;
    if (execution.status !== "success") report.passed = false;
    report.blockedActions += execution.permissionDenials;
    report.timeline.push({
      at: email.at,
      emailRef: digest(email.id).slice(0, 16),
      label:
        connector.mode === "fixture"
          ? email.subject
          : "Authorized email (content withheld)",
      status:
        execution.status !== "success"
          ? "failed"
          : change
            ? "changed"
            : "ignored",
      effectIndexes: context.effects.map((_, i) => i).slice(before),
      executionId: execution.id,
    });
    if (connector.mode === "fixture") {
      const expected = replayLabels[email.id];
      const actual = change ? { ...change, notify: observed!.notify } : null;
      if (digest(actual) === digest(expected)) exact++;
      if (change && expected) tp++;
      else if (change) fp++;
      else if (expected) fn++;
    }
  }
  report.externalWrites =
    connector.mode === "google"
      ? report.effects.filter(
          (e) =>
            e.disposition === "COMMITTED" &&
            e.operation !== "notification.emit",
        ).length
      : 0;
  if (connector.mode === "fixture")
    report.evaluation = {
      labeled: true,
      cases: history.emails.length,
      exactMatches: exact,
      precision: tp + fp ? tp / (tp + fp) : null,
      recall: tp + fn ? tp / (tp + fn) : null,
    };
  // Google raw snapshots are transient. Only redacted observations and effect references persist.
  const persisted = structuredClone(report);
  if (connector.mode === "google")
    persisted.effects.forEach((e) => {
      e.title =
        e.operation === "notification.emit"
          ? "Deadline notification"
          : "Calendar proposal (content withheld)";
      e.date = undefined;
      e.eventRef = e.eventRef ? digest(e.eventRef).slice(0, 16) : undefined;
    });
  return { report: persisted, executions };
}
