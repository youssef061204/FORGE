import { describe, it, expect, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { createForgeMcpServer } from "../src/forge/mcp-registry";
import {
  createWorld,
  energyKw,
  worldMusicUnavailable,
  worldRequests,
} from "../src/forge/world";
import { compile, demoPlan } from "../src/forge/compiler";
import { validateCapability } from "../src/forge/spec";
import { scoutRequest, postings } from "../src/forge/fixtures";

describe("FORGE World: real lifecycle and persisted broker effects", () => {
  it.each([
    "Help me focus",
    "Set things up while I am studying",
    "Get the office ready for studying",
  ])("recognizes a study paraphrase: %s", (request) => {
    const cap = demoPlan(request);
    expect(cap.id).toBe("study-mode");
    expect(
      cap.nodes.find((n) => n.operation === "computer.power")?.config,
    ).toEqual({ on: true });
    expect(cap.nodes.find((n) => n.operation === "tv.power")?.config).toEqual({
      on: false,
    });
    expect(cap.nodes.find((n) => n.operation === "light.set")?.config).toEqual({
      rooms: ["office"],
      on: true,
    });
  });
  it.each([
    "Play music when studying",
    "Play lo-fi music while I study",
    "Create a study mode and play background music",
    "Start my playlist",
  ])(
    "explains unavailable playback without creating a partial routine: %s",
    async (request) => {
      const service = new ForgeService(new MemoryStateStore());
      const before = await service.store.read();
      await expect(service.propose(request)).rejects.toThrow(
        worldMusicUnavailable,
      );
      const after = await service.store.read();
      expect(after.world).toEqual(before.world);
      expect(after.releases).toEqual(before.releases);
      expect(after.effects).toEqual(before.effects);
    },
  );
  it("rejects unavailable playback before calling any model provider", async () => {
    const provider = { generateStructured: vi.fn() };
    await expect(
      compile("Play music while studying", [], provider),
    ).rejects.toThrow(worldMusicUnavailable);
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });
  it("keeps career and text tasks mentioning study or music in their own planners", () => {
    expect(demoPlan("Find music internships while I am studying").id).toBe(
      "internship-scout",
    );
    expect(
      demoPlan("Summarize my study notes about music").nodes[0].operation,
    ).toBe("text.summarize");
  });
  it("resets only World histories and MCP tools, preserving unrelated releases, effects, executions and audit", async () => {
    const service = new ForgeService(new MemoryStateStore());
    for (const request of [scoutRequest, worldRequests.leaving]) {
      const r = await service.propose(request);
      await service.approve(r.definition.id, r.definition.version, r.digest);
    }
    await service.trigger("internship-scout", {
      id: "preserved-career",
      type: "new_job_posting",
      payload: { posting: postings.amd },
    });
    await service.trigger("leaving-home", {
      id: "world-before-reset",
      type: "manual",
      payload: { text: "Leave" },
    });
    await service.probeWorldSecurity();
    const before = await service.store.read();
    const { server, registry } = await createForgeMcpServer(service);
    const client = new Client({ name: "world-reset-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain(
        "leaving_home",
      );
      await service.resetWorldDemo();
      await registry.sync();
      const after = await service.store.read();
      expect(after.world).toEqual(createWorld());
      expect(after.releases).toEqual(
        before.releases.filter((r) => r.definition.id === "internship-scout"),
      );
      expect(after.executions).toEqual(
        before.executions.filter((e) => e.capabilityId === "internship-scout"),
      );
      expect(after.effects).toEqual(
        Object.fromEntries(
          Object.entries(before.effects).filter(
            ([, e]) => e.capabilityId === "internship-scout",
          ),
        ),
      );
      expect(after.audit.slice(0, -1)).toEqual(before.audit);
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).not.toContain("leaving_home");
      expect(names).toContain("internship_scout");
      const again = await service.propose(worldRequests.leaving);
      expect(again.definition.version).toBe("1.0.0");
      expect(again.status).toBe("review");
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("builds through MCP, denies unapproved calls, installs and executes Leaving Home, blocks delivery, extends and rolls back", async () => {
    const service = new ForgeService(new MemoryStateStore());
    const { server, registry } = await createForgeMcpServer(service);
    const client = new Client({ name: "world-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).not.toContain(
        "leaving_home",
      );
      await client.callTool({
        name: "forge.build",
        arguments: { request: worldRequests.leaving },
      });
      const proposal = (await service.store.read()).releases.at(-1)!;
      expect(proposal.resolution).toBe("COMPOSE");
      expect(
        proposal.report.passed,
        JSON.stringify(proposal.report.checks.filter((c) => !c.passed)),
      ).toBe(true);
      expect(proposal.report.checks).toHaveLength(23);
      expect((await service.snapshot()).world).toEqual(createWorld());
      expect(
        (
          await client.callTool({
            name: "leaving_home",
            arguments: { eventId: "unapproved", text: "Run" },
          })
        ).isError,
      ).toBe(true);
      await service.approve(
        proposal.definition.id,
        proposal.definition.version,
        proposal.digest,
      );
      await registry.sync();
      expect((await client.listTools()).tools.map((t) => t.name)).toContain(
        "leaving_home",
      );
      const run = await client.callTool({
        name: "leaving_home",
        arguments: { eventId: "leave-once", text: "Run" },
      });
      expect(run.isError).toBe(false);
      const after = (await service.snapshot()).world;
      expect(after).toMatchObject({
        presence: "away",
        doorLocked: true,
        computerOn: false,
        appliancesOn: false,
        tvOn: true,
        temperature: 21,
      });
      expect(Object.values(after.lights)).toEqual([
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(energyKw(after)).toBeLessThan(energyKw(createWorld()));
      const effects = Object.keys((await service.store.read()).effects).length;
      await client.callTool({
        name: "leaving_home",
        arguments: { eventId: "leave-once", text: "Run again" },
      });
      expect(Object.keys((await service.store.read()).effects)).toHaveLength(
        effects,
      );
      const attack = await service.probeWorldSecurity();
      expect(attack.step).toMatchObject({
        operation: "door.unlock",
        status: "denied",
      });
      expect(attack.doorLocked).toBe(true);
      expect((await service.snapshot()).world.alert?.permissionDenials).toBe(1);
      const extension = await service.propose(worldRequests.extend);
      expect(extension).toMatchObject({
        resolution: "EXTEND",
        definition: { version: "1.1.0", parentVersion: "1.0.0" },
        report: { passed: true },
      });
      expect(extension.diff.addedPermissions).toContain("world.tv.write");
      await service.approve(
        extension.definition.id,
        extension.definition.version,
        extension.digest,
      );
      await registry.sync();
      await service.prepareWorld("active-day");
      await client.callTool({
        name: "leaving_home",
        arguments: { eventId: "under-30", text: "Run" },
      });
      expect((await service.snapshot()).world.temperature).toBe(21);
      await service.prepareWorld("away-45");
      await client.callTool({
        name: "leaving_home",
        arguments: { eventId: "extended", text: "Run" },
      });
      expect((await service.snapshot()).world).toMatchObject({
        temperature: 18,
        tvOn: false,
      });
      await service.rollback("leaving-home", "1.0.0");
      await registry.sync();
      await service.prepareWorld("away-45");
      await client.callTool({
        name: "leaving_home",
        arguments: { eventId: "rolled-back", text: "Run" },
      });
      expect((await service.snapshot()).world).toMatchObject({
        temperature: 21,
        tvOn: true,
      });
    } finally {
      await client.close();
      await server.close();
    }
  }, 30000);
  it("welcome and study capabilities update the selected rooms without installing any canned routines", async () => {
    const service = new ForgeService(new MemoryStateStore());
    expect((await service.snapshot()).releases).toHaveLength(0);
    for (const request of [worldRequests.welcome, worldRequests.study]) {
      const release = await service.propose(request);
      expect(
        release.report.passed,
        JSON.stringify(release.report.checks.filter((c) => !c.passed)),
      ).toBe(true);
      await service.approve(
        release.definition.id,
        release.definition.version,
        release.digest,
      );
    }
    await service.prepareWorld("night-arrival");
    const welcome = await service.trigger("welcome-home", {
      id: "arrive",
      type: "manual",
      payload: { text: "Come home" },
    });
    expect(welcome.status).toBe("success");
    expect((await service.snapshot()).world).toMatchObject({
      timeOfDay: "night",
      presence: "home",
      temperature: 24,
      computerOn: false,
      lights: {
        hallway: true,
        bedroom: true,
        kitchen: false,
        living: false,
        office: false,
      },
    });
    await service.trigger("study-mode", {
      id: "study",
      type: "manual",
      payload: { text: "Study" },
    });
    expect((await service.snapshot()).world).toMatchObject({
      computerOn: true,
      tvOn: false,
      lights: { office: true },
    });
  });
  it("rejects missing write permissions and unbounded thermostat config before any world effect", () => {
    const cap = demoPlan(worldRequests.leaving);
    expect(() =>
      validateCapability({
        ...cap,
        permissions: cap.permissions.filter((p) => p !== "world.door.lock"),
      }),
    ).toThrow(/exact minimum/);
    const bad = structuredClone(cap);
    bad.nodes.find(
      (n) => n.operation === "thermostat.set",
    )!.config.temperature = 90;
    expect(() => validateCapability(bad)).toThrow();
  });
});
