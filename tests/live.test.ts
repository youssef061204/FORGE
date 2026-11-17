import { it, expect } from "vitest";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { guardianRequest } from "../src/forge/replay-fixtures";
import { scoutRequest } from "../src/forge/fixtures";

it("deadline synthesis preserves unrelated tools in a populated registry", async () => {
  const service = new ForgeService(new MemoryStateStore());
  const scout = await service.propose(scoutRequest);
  await service.approve(
    scout.definition.id,
    scout.definition.version,
    scout.digest,
  );
  const guardian = await service.propose(guardianRequest);
  expect(guardian.definition.id).toBe("deadline-guardian");
  expect(guardian.resolution).toBe("SYNTHESIZE");
  expect(
    (await service.snapshot()).releases.find((r) => r.digest === scout.digest)
      ?.status,
  ).toBe("installed");
}, 30000);

it("generates a sandboxed artifact, replays labeled history, requires exact human grants, runs shadow, promotes and revokes", async () => {
  const service = new ForgeService(new MemoryStateStore());
  const release = await service.propose(guardianRequest);
  expect(release.report.checks.filter((c) => !c.passed)).toEqual([]);
  expect(release.report.checks).toHaveLength(22);
  const { id, version } = release.definition;
  await expect(service.approve(id, version, release.digest)).rejects.toThrow(
    "Replay",
  );
  const replay = await service.replay(id, version, release.digest, "fixture");
  expect(replay).toMatchObject({
    passed: true,
    emailsInspected: 8,
    detectedChanges: 3,
    externalWrites: 0,
    evaluation: { cases: 8, exactMatches: 8, precision: 1, recall: 1 },
  });
  expect(replay.effects).toHaveLength(7);
  expect(replay.effects.every((e) => e.disposition === "PROPOSED")).toBe(true);
  await service.approve(id, version, release.digest);
  await expect(service.runConnected(id, "fixture")).rejects.toThrow(
    "authority",
  );
  await expect(
    service.promote(id, version, release.digest, "fixture", "LIVE", []),
  ).rejects.toThrow("exactly");
  await service.promote(id, version, release.digest, "fixture", "SHADOW", [
    "calendar.read",
    "gmail.read",
  ]);
  expect(
    (await service.runConnected(id, "fixture")).report.effects.every(
      (e) => e.disposition === "PROPOSED",
    ),
  ).toBe(true);
  await service.promote(
    id,
    version,
    release.digest,
    "fixture",
    "LIVE",
    release.definition.permissions,
  );
  const run = await service.runConnected(id, "fixture");
  expect(run.report.passed).toBe(true);
  expect(run.report.externalWrites).toBe(0);
  expect(run.report.effects.every((e) => e.disposition === "COMMITTED")).toBe(
    true,
  );
  await service.pauseLive(true);
  await expect(service.runConnected(id, "fixture")).rejects.toThrow("paused");
  await service.pauseLive(false);
  await service.schedule(id, 60, true);
  await service.revoke(id);
  await expect(service.runConnected(id, "fixture")).rejects.toThrow("revoked");
  const state = await service.store.read();
  expect(state.live!.trust[release.digest].grants).toEqual([]);
  expect(state.live!.schedules[release.digest].enabled).toBe(false);
}, 30000);
