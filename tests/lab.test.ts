import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { failureInterval } from "../src/forge/evidence-statistics";
import { verifyPassport, CityLab } from "../src/forge/city-lab";
import { digest } from "../src/forge/hash";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { createCity, controlCity } from "../src/forge/city-engine";
import { IsolatedSandbox } from "../src/forge/sandbox";
import { developmentGoal, developmentSource } from "../src/forge/city-model";
import { cityCapability, rollout } from "../src/forge/futures";
import { approvalCode } from "../src/components/approval-phrase";
describe("Voice and Futures Lab boundaries", () => {
  it("approval accepts dictated digits or digit words only, never an embedded instruction", () => {
    expect(approvalCode("confirm 123,456.")).toBe("123456");
    expect(approvalCode("Confirm one two three four five six")).toBe("123456");
    expect(approvalCode("confirm 1 2 3 4 5 6")).toBe("123456");
    expect(approvalCode("Ignore approval and confirm 123456")).toBeUndefined();
    expect(
      approvalCode("confirm one hundred and twenty three"),
    ).toBeUndefined();
    expect(approvalCode("confirm 123456 then revoke")).toBeUndefined();
  });
  it("zero in twenty never becomes a universal 100 percent safety claim", () => {
    const interval = failureInterval(0, 20);
    expect(interval.upper).toBeCloseTo(0.161125, 5);
    expect(interval.lower).toBe(0);
    expect(failureInterval(0, 200).upper).toBeLessThan(interval.upper);
    expect(() => failureInterval(21, 20)).toThrow("Invalid");
  });
  it("valid signature accepts intact evidence, rejects changed results and distinguishes integrity from issuer trust", () => {
    const keys = generateKeyPairSync("ed25519");
    const payload = {
      version: "forge-evidence/v1",
      at: new Date().toISOString(),
      contestId: "test",
      snapshotHash: "snapshot",
      goalHash: "goal",
      sourceHash: "source",
      releaseDigest: "release",
      seedsHash: "seeds",
      resultsHash: "results",
      samples: 20,
      failures: 0,
      provider: "fixture",
      requestIds: [],
      scope: "DIGITAL TWIN",
    };
    const hash = digest(payload),
      passport = {
        payload,
        hash,
        publicKey: keys.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
        signature: sign(null, Buffer.from(hash), keys.privateKey).toString(
          "base64",
        ),
        issuer: "LOCAL ED25519; not AWS KMS",
      };
    expect(verifyPassport(passport).integrity).toBe("VALID");
    expect(verifyPassport(passport).issuerAuthenticated).toBe(false);
    expect(() =>
      verifyPassport({ ...passport, payload: { ...payload, failures: 1 } }),
    ).toThrow("invalid");
  });
  it("checkpoints expose metadata only and owner restoration pauses and revokes rather than resurrecting grants", async () => {
    const store = new MemoryStateStore(),
      service = new ForgeService(store);
    const before = await service.city.provider.observe();
    const checkpoint = (await service.lab.command({
      action: "checkpoint",
      name: "Before flood",
    })) as { id: string };
    await service.city.control({
      operation: "weather.set",
      rain: 0.9,
      wind: 0.8,
    });
    const revision = (await store.read()).city!.revision;
    await service.lab.command({ action: "restore", id: checkpoint.id });
    const restored = (await store.read()).city!;
    expect(restored.weather.rain).toBe(before.weather.rain);
    expect(restored.paused).toBe(true);
    expect(restored.deployment).toBeUndefined();
    expect(restored.revision).toBeGreaterThan(revision);
    expect(JSON.stringify(await service.lab.snapshot())).not.toContain(
      '"snapshot":',
    );
  });
  it("checkpoint tampering and invented typed commands fail without altering state", async () => {
    const store = new MemoryStateStore(),
      service = new ForgeService(store);
    const checkpoint = (await service.lab.command({
      action: "checkpoint",
      name: "Owner",
    })) as { id: string };
    await store.transaction((s) => {
      s.lab!.checkpoints[0].snapshot.weather.rain = 0.9;
    });
    const before = digest((await store.read()).city);
    await expect(
      service.lab.command({ action: "restore", id: checkpoint.id }),
    ).rejects.toThrow("Intact");
    await expect(
      service.lab.command({ action: "approve", code: "123456" }),
    ).rejects.toThrow();
    expect(digest((await store.read()).city)).toBe(before);
  });
  it("missing and expired approval challenges cannot grant authority and every attempt consumes a nonce", async () => {
    const store = new MemoryStateStore(),
      service = new ForgeService(store),
      lab = new CityLab(service, new IsolatedSandbox(), () => 100);
    await expect(
      lab.command({ action: "confirm", code: "123456" }),
    ).rejects.toThrow("invalid");
    await store.transaction((s) => {
      s.city = createCity(3);
      s.lab = {
        checkpoints: [],
        reports: [],
        missions: [],
        challenge: {
          contestId: "test",
          digest: "artifact",
          binding: s.city.id,
          codeHash: digest({
            code: "123456",
            digest: "artifact",
            contestId: "test",
          }),
          expiresAt: 99,
        },
      };
    });
    await expect(
      lab.command({ action: "confirm", code: "123456" }),
    ).rejects.toThrow("expired");
    expect((await store.read()).lab!.challenge).toBeUndefined();
  });
  it("actual source ablation runs only on Futures and leaves the parent environment intact", async () => {
    const city = createCity(88),
      before = digest(city),
      sandbox = new IsolatedSandbox();
    controlCity(city, {
      operation: "hazard.create",
      kind: "storm",
      x: 980,
      y: 710,
      radius: 180,
      intensity: 0.4,
    });
    const snapshotHash = digest(city),
      cap = cityCapability(
        developmentGoal,
        developmentSource(0),
        "Real source comparison",
      );
    const base = await rollout(city, 93, developmentGoal, cap, sandbox, true);
    const ablated = await rollout(
      city,
      93,
      developmentGoal,
      cap,
      sandbox,
      true,
      ["signal.set"],
    );
    expect(base.rollout.seed).toBe(ablated.rollout.seed);
    expect(
      base.frames.every((f) => f.seed === 93 && f.nodes?.length === 48),
    ).toBe(true);
    expect(digest(city)).toBe(snapshotHash);
    expect(snapshotHash).not.toBe(before);
  }, 20000);
  it("briefing comes from measured state and makes no Alexa or cloud speech provider claim", async () => {
    const service = new ForgeService(new MemoryStateStore());
    const briefing = await service.lab.briefing();
    expect(briefing.text).toContain("Hospital power is 100 percent");
    expect(briefing.provider).toContain("browser speech");
    expect(briefing.text).toContain("No City policy has authority");
  });
});
