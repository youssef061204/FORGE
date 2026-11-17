import { it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { guardianRequest } from "../src/forge/replay-fixtures";
import {
  packageCapsule,
  verifyCapsule,
  serializeCapsule,
} from "../src/forge/capsule";
const generated = generateKeyPairSync("ed25519");
const key = {
  privateKey: generated.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  publicKey: generated.publicKey
    .export({ type: "spki", format: "pem" })
    .toString(),
};
it("packages deterministically, verifies real signatures, rejects meaningful tampering and excludes user data", async () => {
  const service = new ForgeService(new MemoryStateStore());
  const release = await service.propose(
    guardianRequest + " My private plan is PERSONAL-GOAL-123.",
  );
  const a = packageCapsule(release, key),
    b = packageCapsule(release, key);
  expect(serializeCapsule(a)).toBe(serializeCapsule(b));
  expect(verifyCapsule(JSON.parse(serializeCapsule(a))).signature).toBe(
    "VALID",
  );
  const text = serializeCapsule(a);
  for (const value of [
    "PERSONAL-GOAL-123",
    "professor@example.edu",
    "Deadline changed to 2026-10-15",
    "refresh_token",
    "access_token",
    "privateKey",
    'trustedSenders": [',
    "calendarWriteConsent",
  ])
    expect(text).not.toContain(value);
  const changed = structuredClone(a);
  changed.payload.artifact.source += "\n// changed behavior";
  expect(() => verifyCapsule(changed)).toThrow("hash mismatch");
  const signature = structuredClone(a);
  signature.signature.value = Buffer.alloc(64).toString("base64");
  expect(() => verifyCapsule(signature)).toThrow("signature invalid");
  const secret = structuredClone(release);
  secret.definition.executable!.source += "\n// stolen@example.com";
  secret.digest = (await import("../src/forge/hash")).digest(secret.definition);
  expect(() => packageCapsule(secret, key)).toThrow("private data");
}, 30000);
it("a fresh installation verifies and retests imported software without inheriting approval, replay or grants", async () => {
  const source = new ForgeService(new MemoryStateStore());
  const release = await source.propose(guardianRequest);
  await source.replay(
    release.definition.id,
    release.definition.version,
    release.digest,
    "fixture",
  );
  await source.approve(
    release.definition.id,
    release.definition.version,
    release.digest,
  );
  await source.promote(
    release.definition.id,
    release.definition.version,
    release.digest,
    "fixture",
    "LIVE",
    release.definition.permissions,
  );
  const fresh = new ForgeService(new MemoryStateStore());
  const imported = await fresh.importCapsule(packageCapsule(release, key));
  const local = (await fresh.snapshot()).live!.trust[imported.release.digest];
  expect(local).toMatchObject({
    current: "UNTRUSTED",
    grants: [],
    imported: true,
  });
  expect(local.replayId).toBeUndefined();
  expect(imported.release.approvedAt).toBeUndefined();
  expect(imported.release.status).toBe("review");
  await expect(
    fresh.runConnected(imported.release.definition.id, "fixture"),
  ).rejects.toThrow();
  await expect(
    fresh.approve(
      imported.release.definition.id,
      imported.release.definition.version,
      imported.release.digest,
    ),
  ).rejects.toThrow("Replay");
  const replay = await fresh.replay(
    imported.release.definition.id,
    imported.release.definition.version,
    imported.release.digest,
    "fixture",
  );
  expect(replay.passed).toBe(true);
  expect(
    (await fresh.snapshot()).live!.trust[imported.release.digest].grants,
  ).toEqual([]);
}, 30000);
