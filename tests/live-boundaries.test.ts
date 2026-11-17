import { it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ForgeService } from "../src/forge/service";
import { LocalStateStore, MemoryStateStore } from "../src/forge/store";
import { PermissionBroker } from "../src/forge/broker";
import { planLive, deadlineSource } from "../src/forge/live-planner";
import {
  guardianRequest,
  replayHistory,
  fixtureSenders,
} from "../src/forge/replay-fixtures";
import {
  FixtureConnector,
  GoogleConnection,
  type Connector,
} from "../src/forge/connectors";
import { runExecutable } from "../src/forge/executable";
import { SecretVault } from "../src/forge/vault";
import type { LiveContext } from "../src/forge/live-broker";
import { digest } from "../src/forge/hash";
const cap = planLive(guardianRequest)!;
const event = {
  id: "boundary",
  type: cap.trigger,
  payload: { text: "Authorized event", email: replayHistory.emails[0] },
};
async function brokerThroughModule(
  store: MemoryStateStore,
  context: LiveContext,
) {
  const broker = new PermissionBroker(
    cap,
    event,
    store,
    undefined,
    undefined,
    context,
  );
  for (const n of cap.nodes.slice(0, 3)) await broker.invoke(n.id, n.operation);
  return broker;
}
it("replay and shadow cannot call the real connector write function, even with a LIVE trust record", async () => {
  const store = new MemoryStateStore();
  let writes = 0;
  const connector: Connector = {
    mode: "google",
    binding: "test-binding",
    trustedSenders: fixtureSenders,
    snapshot: async () => structuredClone(replayHistory),
    write: async () => {
      writes++;
      return { id: "external" };
    },
  };
  for (const mode of ["REPLAY", "SHADOW"] as const) {
    const context: LiveContext = {
      mode,
      connector,
      history: structuredClone(replayHistory),
      effects: [],
    };
    const broker = await brokerThroughModule(store, context);
    for (const n of cap.nodes.slice(3)) await broker.invoke(n.id, n.operation);
    expect(context.effects).toHaveLength(2);
    expect(context.effects.every((e) => e.disposition === "PROPOSED")).toBe(
      true,
    );
  }
  expect(writes).toBe(0);
});
it("the broker denies a declared Calendar write before promotion and after revocation or global pause", async () => {
  const store = new MemoryStateStore();
  const connector = new FixtureConnector();
  const context: LiveContext = {
    mode: "LIVE",
    connector,
    history: structuredClone(replayHistory),
    effects: [],
  };
  const broker = await brokerThroughModule(store, context);
  await expect(
    broker.invoke(cap.nodes[3].id, "calendar.update"),
  ).rejects.toThrow("live grant missing");
  expect(connector.writes).toHaveLength(0);
  expect(broker.trace.at(-1)?.status).toBe("denied");
});
it("Google-shaped deployment requires replay and owner approval; successful writes persist receipts, subsequent polling skips processed mail and revocation denies dispatch", async () => {
  let writes = 0;
  let assignmentRevision = 0;
  const history = structuredClone(replayHistory);
  history.events[0].etag = "revision-0";
  history.emails.push({
    ...history.emails[0],
    id: "later-deadline",
    at: "2026-10-16T09:00:00Z",
    body: "Deadline moved to 2026-10-23.",
  });
  const connector: Connector = {
    mode: "google",
    binding: "injected-google-binding",
    trustedSenders: fixtureSenders,
    snapshot: async () => structuredClone(history),
    write: async (effect, _key, etag) => {
      writes++;
      if (
        effect.operation === "calendar.update" &&
        effect.eventRef === "assignment"
      ) {
        expect(etag).toBe("revision-" + assignmentRevision);
        assignmentRevision++;
        return { id: "assignment", etag: "revision-" + assignmentRevision };
      }
      return { id: effect.eventRef ?? "mock-event-" + writes, etag: "written" };
    },
  };
  const connection = new GoogleConnection();
  vi.spyOn(connection, "connector").mockResolvedValue(connector);
  vi.spyOn(connection, "status").mockResolvedValue({
    configured: true,
    connected: true,
    calendarWriteConsent: true,
    calendarConfigured: true,
    sendersConfigured: true,
    binding: connector.binding,
  });
  const service = new ForgeService(
    new MemoryStateStore(),
    undefined,
    undefined,
    connection,
  );
  const release = await service.propose(guardianRequest);
  const { id, version } = release.definition;
  await expect(service.runConnected(id, "google")).rejects.toThrow();
  const replay = await service.replay(id, version, release.digest, "google");
  expect(writes).toBe(0);
  expect(replay.evaluation).toBeUndefined();
  expect(JSON.stringify(replay)).not.toContain("CS101");
  await service.approve(id, version, release.digest);
  await service.promote(
    id,
    version,
    release.digest,
    "google",
    "LIVE",
    release.definition.permissions,
  );
  expect((await service.runConnected(id, "google")).report).toMatchObject({
    passed: true,
    externalWrites: 8,
  });
  expect(writes).toBe(8);
  expect(assignmentRevision).toBe(2);
  expect(
    (await service.runConnected(id, "google")).report.emailsInspected,
  ).toBe(0);
  expect(writes).toBe(8);
  await service.revoke(id);
  await expect(service.runConnected(id, "google")).rejects.toThrow("revoked");
}, 30000);
it("source cannot escape the broker through computed constructors; infinite loops terminate in the actual sandbox", async () => {
  const input = {
    email: replayHistory.emails[0],
    events: replayHistory.events,
    trustedSenders: fixtureSenders,
  };
  await expect(
    runExecutable(
      'function execute(input: ModuleInput): ModuleOutput { const c = ({} as Record<string, any>)["con"+"structor"]; c["con"+"structor"]("return process")(); return {change:null,notify:false}; }',
      input,
    ),
  ).rejects.toThrow();
  await expect(
    runExecutable(
      "function execute(input: ModuleInput): ModuleOutput { while(true) {} }",
      input,
    ),
  ).rejects.toThrow();
  const hostile = {
    ...input,
    email: {
      ...input.email,
      body: 'Deadline moved to 2026-10-15. "); process.exit(); //',
    },
  };
  expect((await runExecutable(deadlineSource, hostile)).change?.date).toBe(
    "2026-10-15",
  );
});
it("encrypted tokens survive restart without appearing in snapshots or plaintext files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forge-vault-test-"));
  try {
    const a = new SecretVault(directory);
    await a.set("google", {
      access_token: "TEST-SECRET-ACCESS",
      refresh_token: "TEST-SECRET-REFRESH",
      scope: "read",
      expiresAt: Date.now() + 3600000,
      binding: "test",
    });
    const b = new SecretVault(directory);
    expect(await b.get("google")).toMatchObject({
      access_token: "TEST-SECRET-ACCESS",
    });
    expect(
      (await readFile(join(directory, "secrets.enc"))).includes(
        Buffer.from("TEST-SECRET"),
      ),
    ).toBe(false);
    const connection = new GoogleConnection(b);
    expect(JSON.stringify(await connection.status())).not.toContain(
      "TEST-SECRET",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("durable trust, schedules and pause survive restart; a revoked schedule never dispatches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forge-restart-test-"));
  try {
    const a = new ForgeService(new LocalStateStore(directory));
    const r = await a.propose(guardianRequest);
    await a.replay(r.definition.id, r.definition.version, r.digest, "fixture");
    await a.approve(r.definition.id, r.definition.version, r.digest);
    await a.promote(
      r.definition.id,
      r.definition.version,
      r.digest,
      "fixture",
      "LIVE",
      r.definition.permissions,
    );
    await a.schedule(r.definition.id, 60, true);
    await a.pauseLive(true);
    const b = new ForgeService(new LocalStateStore(directory));
    let before = await b.snapshot();
    expect(before.live!.paused).toBe(true);
    expect(before.live!.trust[r.digest].grants).toHaveLength(4);
    const count = before.executions.length;
    await b.tick(Date.now() + 120000);
    expect((await b.snapshot()).executions).toHaveLength(count);
    await b.pauseLive(false);
    await b.tick(Date.now() + 120000);
    before = await b.snapshot();
    expect(before.executions.length).toBeGreaterThan(count);
    await b.revoke(r.definition.id);
    const after = (await b.snapshot()).executions.length;
    await b.tick(Date.now() + 240000);
    expect((await b.snapshot()).executions).toHaveLength(after);
    expect(before.releases[0].digest).toBe(digest(r.definition));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
