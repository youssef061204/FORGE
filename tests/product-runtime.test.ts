import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { harness, draft, synthesis, now } from "./product-fixtures";
import { ProductRuntime } from "../src/forge/product/runtime";
import {
  OfflineMissionModel,
  type MissionModel,
} from "../src/forge/product/provider";
import { ConnectorHttpError } from "../src/forge/product/network";
import {
  LocalStateStore,
  MemoryStateStore,
  type StateStore,
} from "../src/forge/store";
import { ForgeService } from "../src/forge/service";
import { createForgeMcpServer } from "../src/forge/mcp-registry";
describe("resource-driven product runtime", () => {
  it.each(["new-tool", "wrong-parent"])(
    "does not let a model turn an explicit edit into %s",
    async (kind) => {
      let calls = 0;
      let target = "";
      const h = harness((context) => {
        calls++;
        if (calls === 1) return synthesis();
        expect(context.editTargetId).toBe(target);
        expect(context.existing[0].id).toBe(target);
        return kind === "new-tool"
          ? synthesis(draft("2026-10-21"))
          : {
              ...synthesis(draft("2026-10-21")),
              route: "EXTEND",
              existingIds: ["wrong-tool"],
            };
      });
      const first = (await h.runtime.ask("Watch course deadlines")).tool!;
      await h.runtime.approve(first.id, first.hash, first.permissions);
      target = first.id;
      await expect(
        h.runtime.ask(
          "Move those deadlines one day later",
          "explicit-edit",
          target,
        ),
      ).rejects.toThrow(/explicit edit/);
      expect((await h.store.read()).product!.programs).toHaveLength(1);
      await expect(
        h.runtime.ask("Edit a missing tool", "missing-edit", "unknown-tool"),
      ).rejects.toThrow(/selected for editing is unavailable/);
      expect(calls).toBe(2);
    },
  );
  it("keeps a conversational previous tool separate from explicit edit intent", async () => {
    const contexts: Array<{ editTargetId?: string; followUpId?: string }> = [];
    const h = harness((context) => {
      contexts.push(context);
      return synthesis();
    });
    const first = (await h.runtime.ask("Watch course deadlines")).tool!;
    await h.runtime.approve(first.id, first.hash, first.permissions);
    const second = await h.runtime.ask("Build an unrelated deadline tool");
    expect(contexts[1].followUpId).toBe(first.id);
    expect(contexts[1].editTargetId).toBeUndefined();
    expect(second.route).toBe("SYNTHESIZE");
    expect(second.tool!.id).not.toBe(first.id);
  });
  it("grounds review text in actual operations instead of a model's claimed effects", async () => {
    const h = harness(() => ({
      ...synthesis(),
      explanation: "Your Google Calendar has been updated.",
    }));
    const result = await h.runtime.ask("Watch the course deadlines");
    expect(result.explanation).toContain("Move deadline");
    expect(result.explanation).toContain("Nothing has run");
    expect(result.explanation).not.toContain("Calendar");
    expect(result.tool?.status).toBe("review");
    expect(result.tool?.grants).toEqual([]);
    expect(h.tasks.writes).toEqual([]);
  });
  it("binds extension lineage to the reviewed digest", async () => {
    const h = harness((context) =>
      context.followUpId
        ? {
            ...synthesis(draft("2026-10-21")),
            route: "EXTEND",
            existingIds: [context.followUpId],
          }
        : synthesis(),
    );
    const first = (await h.runtime.ask("Watch the course deadlines")).tool!;
    await h.runtime.approve(first.id, first.hash, first.permissions);
    const update = (
      await h.runtime.ask("Also move those deadlines one day later")
    ).tool!;
    await h.store.transaction((state) => {
      state.product!.programs.find(
        (tool) => tool.hash === update.hash,
      )!.parentHash = "0".repeat(64);
    });
    await expect(
      h.runtime.approve(update.id, update.hash, update.permissions),
    ).rejects.toThrow(/metadata changed/);
  });
  it("composes two distinct installed strategies into independently approved source with hashed provenance", async () => {
    let proposals = 0;
    let ids: string[] = [];
    const notify = draft();
    notify.name = "Urgency notification";
    notify.actions = ["notification.emit"];
    notify.source =
      'function execute(input: ModuleInput): ModuleOutput { const operations: ModuleOutput["operations"] = []; for (const task of input.observations.tasks.tasks) { if (task.urgent) operations.push({operation:"notification.emit",arguments:{message:"Urgent course task"}}); } return {operations,result:{summary:"Urgency checked"},state:{}}; }';
    notify.tests[0].expectedOperations = ["notification.emit"];
    const composed = draft();
    composed.name = "Deadline and urgency coordinator";
    composed.actions.push("notification.emit");
    composed.source = composed.source.replace(
      'operations.push({operation:"tasks.move",arguments:{id:task.id,due:"2026-10-20"}});',
      'operations.push({operation:"tasks.move",arguments:{id:task.id,due:"2026-10-20"}}); operations.push({operation:"notification.emit",arguments:{message:"Deadline aligned"}});',
    );
    composed.tests[0].expectedOperations.push("notification.emit");
    const h = harness(() => {
      proposals++;
      return proposals === 1
        ? synthesis()
        : proposals === 2
          ? synthesis(notify)
          : { ...synthesis(composed), route: "COMPOSE", existingIds: ids };
    });
    const first = (await h.runtime.ask("Align urgent task deadlines")).tool!;
    await h.runtime.approve(first.id, first.hash, first.permissions);
    const second = (await h.runtime.ask("Notify about urgent course tasks"))
      .tool!;
    await h.runtime.approve(second.id, second.hash, second.permissions);
    ids = [first.id, second.id];
    const combined = (
      await h.runtime.ask("Combine those two tools into a coordinator")
    ).tool!;
    expect(combined.provenance.map((p) => p.hash)).toEqual([
      first.hash,
      second.hash,
    ]);
    expect(combined.grants).toEqual([]);
    await expect(h.runtime.run(combined.id)).rejects.toThrow(/unapproved/);
    await h.runtime.approve(combined.id, combined.hash, combined.permissions);
    const run = await h.runtime.run(combined.id, "combined", {}, now);
    expect(run.status).toBe("done");
    expect(run.receipts.map((r) => r.operation)).toEqual([
      "tasks.move",
      "notification.emit",
    ]);
    await h.store.transaction((state) => {
      state.product!.programs.find(
        (p) => p.id === combined.id,
      )!.provenance[0].hash = "0".repeat(64);
    });
    await expect(h.runtime.run(combined.id, "tampered")).rejects.toThrow(
      /metadata changed/,
    );
  });
  it("delivers connector events only to the exact approved binding and recovers durable pending input", async () => {
    const program = draft();
    program.trigger = {
      kind: "connector_event",
      connector: "tasks",
      event: "deadline_changed",
    };
    const h = harness(() => synthesis(program));
    const tool = (await h.runtime.ask("Watch connector deadline changes"))
      .tool!;
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    await expect(
      h.runtime.deliverEvent(tool.id, "calendar", "deadline_changed", "bad"),
    ).rejects.toThrow(/not bound/);
    const run = await h.runtime.deliverEvent(
      tool.id,
      "tasks",
      "deadline_changed",
      "event-a",
      {},
      now,
    );
    expect(run.status).toBe("done");
    expect(
      (
        await h.runtime.deliverEvent(
          tool.id,
          "tasks",
          "deadline_changed",
          "event-a",
          {},
          now,
        )
      ).status,
    ).toBe("ignored");
    expect(h.tasks.writes).toHaveLength(1);
    h.tasks.tasks[0].due = "2026-10-18";
    await h.store.transaction((state) => {
      state.product!.triggerEvents["connector:recovered"] = {
        toolId: tool.id,
        hash: tool.hash,
        status: "pending",
        at: now,
        input: { originalPayload: true },
      };
    });
    await new ProductRuntime(h.store, h.fabric, h.model).tick(now);
    expect(
      (await h.store.read()).product!.triggerEvents["connector:recovered"]
        .status,
    ).toBe("done");
    expect(h.tasks.writes).toHaveLength(2);
    await h.runtime.action(tool.id, tool.hash, "revoke");
    await expect(
      h.runtime.deliverEvent(tool.id, "tasks", "deadline_changed", "revoked"),
    ).rejects.toThrow(/revoked/);
  });
  it("rechecks changed bindings without a planning request or inherited grants", async () => {
    const h = harness();
    const tool = (await h.runtime.ask("Watch my urgent deadlines")).tool!;
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    h.tasks.binding = "owner-reconnected";
    const checked = await h.runtime.recheck(tool.id, tool.hash);
    expect(checked.version).toBe("1.1.0");
    expect(checked.bindings.tasks).toBe("owner-reconnected");
    expect(checked.grants).toEqual([]);
    expect(h.model.calls).toBe(1);
    await h.runtime.approve(checked.id, checked.hash, checked.permissions);
    expect(
      (await h.runtime.run(checked.id, "new-binding", {}, now)).status,
    ).toBe("done");
  });
  it("treats a failed persistence acknowledgement as an uncertain external write", async () => {
    const delegate = new MemoryStateStore();
    let failCommit = false;
    const store: StateStore = {
      read: () => delegate.read(),
      transaction: (callback) =>
        delegate.transaction(async (state) => {
          const before = Object.values(state.product?.outbox ?? {}).filter(
            (entry) => entry.status === "committed",
          ).length;
          const result = await callback(state);
          if (
            failCommit &&
            Object.values(state.product?.outbox ?? {}).filter(
              (entry) => entry.status === "committed",
            ).length > before
          ) {
            failCommit = false;
            throw new Error("Persistence acknowledgement failed");
          }
          return result;
        }),
    };
    const h = harness(() => synthesis(), store);
    const tool = (
      await h.runtime.ask("Change a deadline with durable acknowledgement")
    ).tool!;
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    failCommit = true;
    const run = await h.runtime.run(tool.id, "disk-failure", {}, now);
    expect(run.status).toBe("failed");
    expect(h.tasks.writes).toHaveLength(1);
    expect(Object.values((await store.read()).product!.outbox)[0].status).toBe(
      "uncertain",
    );
    const retry = await h.runtime.run(tool.id, "disk-failure", {}, now);
    expect(retry.status).toBe("failed");
    expect(h.tasks.writes).toHaveLength(1);
  });
  it("contains schema drift before any write", async () => {
    const h = harness();
    const tool = (await h.runtime.ask("Keep this task aligned")).tool!;
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    const invoke = h.tasks.invoke.bind(h.tasks);
    vi.spyOn(h.tasks, "invoke").mockImplementation(async (id, args, context) =>
      id === "tasks.list"
        ? { data: { tasks: [{ renamedField: true }] } }
        : invoke(id, args, context),
    );
    expect((await h.runtime.run(tool.id, "drift", {}, now)).status).toBe(
      "failed",
    );
    expect(h.tasks.writes).toHaveLength(0);
  });
  it("persists the exact action plan across partial failure and changed observations", async () => {
    const h = harness();
    h.tasks.tasks.push({
      id: "task-b",
      title: "Course B",
      due: "2026-10-18",
      urgent: true,
    });
    const tool = (await h.runtime.ask("Move two course deadlines safely"))
      .tool!;
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    const invoke = h.tasks.invoke.bind(h.tasks);
    let fail = true;
    vi.spyOn(h.tasks, "invoke").mockImplementation(
      async (id, args, context) => {
        if (id === "tasks.move" && args.id === "task-b" && fail)
          throw new ConnectorHttpError(429);
        return invoke(id, args, context);
      },
    );
    const first = await h.runtime.run(tool.id, "partial", {}, now);
    expect(first.status).toBe("failed");
    expect(first.receipts).toHaveLength(1);
    // New observations would normally reorder/omit the first action. The durable
    // plan must still identify the already committed original write exactly.
    h.tasks.tasks.reverse();
    fail = false;
    const recovered = await new ProductRuntime(h.store, h.fabric, h.model).run(
      tool.id,
      "partial",
      {},
      now,
    );
    expect(recovered.status).toBe("done");
    expect(recovered.receipts.map((receipt) => receipt.status)).toEqual([
      "deduplicated",
      "committed",
    ]);
    expect(h.tasks.writes.map((write) => write.id)).toEqual([
      "task-a",
      "task-b",
    ]);
  });
  it("contains provider timeout without installing a substitute tool", async () => {
    const h = harness(() => {
      throw new Error("Bedrock request timed out");
    });
    await expect(h.runtime.ask("An arbitrary broad mission")).rejects.toThrow(
      /timed out/,
    );
    expect((await h.store.read()).product!.programs).toHaveLength(0);
    expect([...h.runtime.builds.values()][0].status).toBe("failed");
    expect(h.tasks.writes).toHaveLength(0);
  });
  it("builds actual source, intercepts replay, grants exact permissions and deduplicates writes", async () => {
    const h = harness();
    const result = await h.runtime.ask(
      "Coordinate these course tasks from their actual schema",
    );
    const tool = result.tool!;
    expect(result.state).toBe("review");
    expect(tool.permissions).toEqual(["tasks.move.write", "tasks.read"]);
    expect(tool.evidence.replay).toMatchObject({
      externalWrites: 0,
      proposedOperations: 1,
      source: "test_connector",
    });
    expect(h.tasks.writes).toHaveLength(0);
    await expect(h.runtime.run(tool.id)).rejects.toThrow(/unapproved/);
    await expect(
      h.runtime.approve(tool.id, tool.hash, [
        ...tool.permissions,
        "gmail.read",
      ]),
    ).rejects.toThrow(/exactly/);
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    const run = await h.runtime.run(tool.id, "same-event", {}, now);
    expect(run.status).toBe("done");
    expect(run.mode).toBe("test");
    expect(h.tasks.tasks[0].due).toBe("2026-10-20");
    expect(h.tasks.writes).toHaveLength(1);
    expect((await h.runtime.run(tool.id, "same-event", {}, now)).status).toBe(
      "ignored",
    );
    expect(h.tasks.writes).toHaveLength(1);
    await h.runtime.action(tool.id, tool.hash, "revoke");
    await expect(h.runtime.run(tool.id, "revoked")).rejects.toThrow(/revoked/);
  });
  it("reuses exact installed goals without another planning request; passes contextual source to extension", async () => {
    const h = harness((context) =>
      context.followUpId
        ? {
            ...synthesis(draft("2026-10-21")),
            route: "EXTEND",
            existingIds: [context.followUpId],
          }
        : synthesis(),
    );
    const goal = "Keep semester course deadlines aligned";
    const first = (await h.runtime.ask(goal)).tool!;
    await h.runtime.approve(first.id, first.hash, first.permissions);
    expect((await h.runtime.ask(goal)).state).toBe("reuse");
    expect(h.model.calls).toBe(1);
    const second = (await h.runtime.ask("Also move it to the following day"))
      .tool!;
    expect(second.id).toBe(first.id);
    expect(second.version).toBe("1.1.0");
    expect(second.parentHash).toBe(first.hash);
    expect(second.grants).toEqual([]);
    await h.runtime.approve(second.id, second.hash, second.permissions);
    await h.runtime.run(second.id, "v2", {}, now);
    expect(h.tasks.tasks[0].due).toBe("2026-10-21");
    await h.runtime.rollback(first.id, first.hash);
    await h.runtime.approve(first.id, first.hash, first.permissions);
    await h.runtime.run(first.id, "rollback", {}, now);
    expect(h.tasks.tasks[0].due).toBe("2026-10-20");
  });
  it("keeps arbitrary offline requests away from fixture routing and honors a zero live budget", async () => {
    const h = harness();
    const offline = new ProductRuntime(
      h.store,
      h.fabric,
      new OfflineMissionModel(),
    );
    for (const goal of [
      "Play music while studying",
      "Keep Friday evenings free",
      "Leaving home now",
      "Summarize anything unusual",
    ]) {
      const r = await offline.ask(goal);
      expect(r.state).toBe("offline");
      expect(r.explanation).not.toContain("deterministic planner");
    }
    let calls = 0;
    const live: MissionModel = {
      mode: "live",
      status: async () => ({ ready: true, label: "Bedrock" }),
      plan: async () => {
        calls++;
        return h.model.plan({
          goal: "unused",
          resources: [],
          existing: [],
          conversation: [],
        });
      },
    };
    expect(
      (
        await new ProductRuntime(h.store, h.fabric, live, "process", 0).ask(
          "An arbitrary live goal",
        )
      ).state,
    ).toBe("offline");
    expect(calls).toBe(0);
  });
  it("contains malformed source, undeclared operations, and changed connector bindings", async () => {
    const unsafe = harness(() =>
      synthesis({
        ...draft(),
        source:
          'function execute(input: ModuleInput): ModuleOutput { return fetch("https://example.com"); }',
      }),
    );
    await expect(
      unsafe.runtime.ask("Build an unsafe arbitrary tool"),
    ).rejects.toThrow(/Prohibited/);
    expect((await unsafe.store.read()).product?.programs ?? []).toHaveLength(0);
    const h = harness();
    const tool = (await h.runtime.ask("Keep this deadline synchronized")).tool!;
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    h.tasks.binding = "different-owner";
    await expect(h.runtime.run(tool.id)).rejects.toThrow(/identity changed/);
    expect(h.tasks.writes).toHaveLength(0);
  });
  it.each([401, 429])(
    "records HTTP %i without fallback and permits an explicit retry",
    async (code) => {
      const h = harness();
      const tool = (await h.runtime.ask("Align the actual deadline")).tool!;
      await h.runtime.approve(tool.id, tool.hash, tool.permissions);
      h.tasks.fail = new ConnectorHttpError(code);
      expect((await h.runtime.run(tool.id, "auth-test", {}, now)).status).toBe(
        "failed",
      );
      expect(h.tasks.writes).toHaveLength(0);
      h.tasks.fail = undefined;
      expect((await h.runtime.run(tool.id, "auth-test", {}, now)).status).toBe(
        "done",
      );
      expect(h.tasks.writes).toHaveLength(1);
    },
  );
  it("blocks retries of uncertain writes after a timeout", async () => {
    const h = harness();
    const tool = (await h.runtime.ask("Update deadline safely")).tool!;
    await h.runtime.approve(tool.id, tool.hash, tool.permissions);
    h.tasks.fail = new Error("Connector timeout");
    expect((await h.runtime.run(tool.id, "timeout", {}, now)).status).toBe(
      "failed",
    );
    h.tasks.fail = undefined;
    const retry = await h.runtime.run(tool.id, "timeout", {}, now);
    expect(retry.status).toBe("failed");
    expect(retry.error).toMatch(/uncertain/);
    expect(h.tasks.writes).toHaveLength(0);
  });
  it("restores versions, grants and pending scheduled events from disk without duplicate effects", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forge-product-"));
    try {
      const program = draft();
      program.trigger = { kind: "poll", intervalSeconds: 60 };
      const h = harness(
        () => synthesis(program),
        new LocalStateStore(directory),
      );
      const tool = (await h.runtime.ask("Continuously align the test deadline"))
        .tool!;
      await h.runtime.approve(tool.id, tool.hash, tool.permissions);
      const due = "2026-10-10T15:01:00.000Z";
      const eventId = "scheduled:" + tool.id + ":" + tool.hash + ":" + due;
      await h.store.transaction((state) => {
        state.product!.programs[0].nextRunAt = due;
        state.product!.triggerEvents[eventId] = {
          toolId: tool.id,
          status: "pending",
          at: due,
        };
      });
      const restarted = new ProductRuntime(
        new LocalStateStore(directory),
        h.fabric,
        h.model,
      );
      await restarted.tick(due);
      await restarted.tick(due);
      const state = await new LocalStateStore(directory).read();
      expect(state.product!.triggerEvents[eventId].status).toBe("done");
      expect(state.product!.runs).toHaveLength(1);
      expect(h.tasks.writes).toHaveLength(1);
      expect(state.product!.programs[0].hash).toBe(tool.hash);
      await restarted.action(tool.id, tool.hash, "revoke");
      expect(
        (await new LocalStateStore(directory).read()).product!.programs[0]
          .grants,
      ).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("exposes the approved program through the existing MCP server and removes revoked authority", async () => {
    const h = harness();
    const service = new ForgeService(h.store);
    service.product = h.runtime;
    const { server, registry } = await createForgeMcpServer(service);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "assistant-test", version: "1" });
    await server.connect(b);
    await client.connect(a);
    try {
      const initial = await client.listTools();
      expect(initial.tools.some((t) => t.name.startsWith("tool_"))).toBe(false);
      const response = await client.callTool({
        name: "forge.build",
        arguments: {
          request: "Move urgent task deadlines using the connected schemas",
        },
      });
      const tool = JSON.parse(
        (response.content as { text: string }[])[0].text,
      ).tool;
      await h.runtime.approve(tool.id, tool.hash, tool.permissions);
      await registry.sync();
      const name = (await client.listTools()).tools.find((t) =>
        t.name.startsWith("tool_"),
      )!.name;
      expect(
        (await client.callTool({ name, arguments: { eventId: "mcp-real" } }))
          .structuredContent,
      ).toMatchObject({ status: "done", mode: "test" });
      expect(h.tasks.writes).toHaveLength(1);
      await h.runtime.action(tool.id, tool.hash, "revoke");
      await registry.sync();
      expect(
        (await client.listTools()).tools.some((t) => t.name === name),
      ).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
