import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { harness, draft, synthesis, now } from "../tests/product-fixtures";
import { ProductRuntime } from "../src/forge/product/runtime";
import { ConnectorHttpError } from "../src/forge/product/network";
import { digest } from "../src/forge/hash";

const directory = "artifacts/product";
await mkdir(directory, { recursive: true });
const program = draft();
program.trigger = {
  kind: "connector_event",
  connector: "tasks",
  event: "changed",
};
const h = harness(() => synthesis(program));
const tool = (
  await h.runtime.ask(
    "Deliver approved task changes from the local connector relay",
  )
).tool!;
await h.runtime.approve(tool.id, tool.hash, tool.permissions);
const corpus = Array.from({ length: 50 }, (_, i) => ({
  id: `event-${i}`,
  due: `2026-10-${String(11 + (i % 8)).padStart(2, "0")}`,
}));
await writeFile(
  directory + "/trigger-corpus.json",
  JSON.stringify(corpus, null, 2),
);
const events = [];
for (const item of corpus) {
  h.tasks.tasks[0].due = item.due;
  const start = performance.now();
  const result = await h.runtime.deliverEvent(
    tool.id,
    "tasks",
    "changed",
    item.id,
    {},
    now,
  );
  const duplicate = await h.runtime.deliverEvent(
    tool.id,
    "tasks",
    "changed",
    item.id,
    {},
    now,
  );
  assert.equal(result.status, "done");
  assert.equal(duplicate.status, "ignored");
  events.push({
    id: item.id,
    passed: true,
    latencyMs: performance.now() - start,
  });
}
assert.equal(h.tasks.writes.length, 50);
// Recover a durable pending event without a provider call, then prove its
// committed plan remains reserved after creating another runtime instance.
h.tasks.tasks[0].due = "2026-10-18";
await h.store.transaction((state) => {
  state.product!.triggerEvents["connector:restart"] = {
    toolId: tool.id,
    hash: tool.hash,
    status: "pending",
    at: now,
    input: { persisted: true },
  };
});
await new ProductRuntime(h.store, h.fabric, h.model).tick(now);
assert.equal(h.tasks.writes.length, 51);
await new ProductRuntime(h.store, h.fabric, h.model).tick(now);
assert.equal(h.tasks.writes.length, 51);
const failures = [];
for (const status of [401, 403, 429]) {
  h.tasks.tasks[0].due = "2026-10-18";
  h.tasks.fail = new ConnectorHttpError(status);
  const before: number = h.tasks.writes.length;
  const result = await h.runtime.run(tool.id, `http-${status}`, {}, now);
  assert.equal(result.status, "failed");
  assert.equal(h.tasks.writes.length, before);
  h.tasks.fail = undefined;
  assert.equal(
    (await h.runtime.run(tool.id, `http-${status}`, {}, now)).status,
    "done",
  );
  failures.push({
    category: `HTTP ${status}`,
    contained: true,
    explicitRetrySucceeded: true,
  });
}
h.tasks.tasks[0].due = "2026-10-18";
h.tasks.fail = new Error("Write acknowledgement timed out");
const before = h.tasks.writes.length;
assert.equal(
  (await h.runtime.run(tool.id, "timeout", {}, now)).status,
  "failed",
);
h.tasks.fail = undefined;
assert.equal(
  (await h.runtime.run(tool.id, "timeout", {}, now)).status,
  "failed",
);
assert.equal(h.tasks.writes.length, before);
failures.push({
  category: "Uncertain acknowledgement",
  contained: true,
  explicitRetrySucceeded: false,
});
await h.runtime.action(tool.id, tool.hash, "pause");
await assert.rejects(
  () => h.runtime.deliverEvent(tool.id, "tasks", "changed", "paused"),
  /paused/,
);
await h.runtime.action(tool.id, tool.hash, "resume");
await h.runtime.action(tool.id, tool.hash, "revoke");
await assert.rejects(
  () => h.runtime.deliverEvent(tool.id, "tasks", "changed", "revoked"),
  /revoked/,
);
await h.fabric.discover();
const permissions = [];
let tp = 0,
  fp = 0,
  fn = 0;
for (let i = 0; i < 50; i++) {
  const candidate = draft();
  candidate.reads = i % 2 ? candidate.reads : [];
  candidate.actions =
    i % 3 === 0
      ? []
      : i % 3 === 1
        ? ["tasks.move"]
        : ["tasks.move", "notification.emit"];
  candidate.trigger = { kind: "manual" };
  const expected = [
    ...(i % 2 ? ["tasks.read"] : []),
    ...(i % 3 === 0
      ? []
      : i % 3 === 1
        ? ["tasks.move.write"]
        : ["tasks.move.write", "notification.emit"]),
  ].sort();
  const actual = h.fabric.validateDraft(candidate).permissions;
  for (const p of actual) {
    if (expected.includes(p)) tp++;
    else fp++;
  }
  for (const p of expected) if (!actual.includes(p)) fn++;
  assert.deepEqual(actual, expected);
  permissions.push({ id: `permission-${i}`, expected, actual, passed: true });
}
const sorted = events.map((e) => e.latencyMs).sort((a, b) => a - b);
const report = {
  at: new Date().toISOString(),
  liveBedrockRequests: 0,
  externalWrites: 0,
  scope:
    "Controlled test connector, one hand-authored recorded source; local owner relay and runtime restoration, not remote webhook or NL synthesis reliability.",
  triggers: {
    uniqueEvents: 50,
    completed: 50,
    duplicateDeliveries: 50,
    duplicatesSuppressed: 50,
    actualTestWrites: 50,
    p50DeliveryAndDuplicateMs: sorted[25],
    p95DeliveryAndDuplicateMs: sorted[47],
    pausedBlocked: true,
    revokedBlocked: true,
  },
  recovery: {
    pendingEvents: 1,
    recovered: 1,
    duplicateWrites: 0,
    storage:
      "Same durable store, newly constructed runtime; separate unit test covers disk restart",
  },
  failures,
  permissions: {
    cases: 50,
    exactSets: 50,
    precision: tp / (tp + fp),
    recall: tp / (tp + fn),
    scope:
      "Declared operation permission derivation, not NL intent precision/recall",
    rows: permissions,
  },
  corpusHash: digest(corpus),
  events,
};
await writeFile(
  directory + "/reliability-benchmark.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      ...report,
      events: undefined,
      permissions: { ...report.permissions, rows: undefined },
    },
    null,
    2,
  ),
);
