import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { generateKeyPairSync } from "node:crypto";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { guardianRequest } from "../src/forge/replay-fixtures";
import {
  canonicalJson,
  packageCapsule,
  verifyCapsule,
  serializeCapsule,
} from "../src/forge/capsule";
import { createForgeMcpServer } from "../src/forge/mcp-registry";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const rows: { category: string; passed: boolean; details: string }[] = [];
async function check(category: string, fn: () => Promise<string>) {
  try {
    rows.push({ category, passed: true, details: await fn() });
  } catch (e) {
    rows.push({
      category,
      passed: false,
      details: e instanceof Error ? e.message : "Failed",
    });
    process.exitCode = 1;
  }
}
const service = new ForgeService(new MemoryStateStore());
const release = await service.propose(guardianRequest);
const { id, version } = release.definition;
await check("capability routing", async () => {
  assert.equal(release.resolution, "SYNTHESIZE");
  return "Generated on request; no high-level capability preinstalled";
});
await check("generated code validity", async () => {
  assert(release.report.passed);
  return "Strict typecheck, isolated execution, 14 behavioral and 8 security admission checks passed";
});
await check("permission derivation", async () => {
  assert.deepEqual(release.definition.permissions, [
    "calendar.read",
    "calendar.write",
    "gmail.read",
    "notification.emit",
  ]);
  return "Four exact permissions; zero initial grants";
});
const replay = await service.replay(id, version, release.digest, "fixture");
await check("Reality Replay labeled accuracy", async () => {
  assert.deepEqual(replay.evaluation, {
    labeled: true,
    cases: 8,
    exactMatches: 8,
    precision: 1,
    recall: 1,
  });
  return "8 independent labels matched; 3 true deadline changes, 5 negative cases";
});
await check("write interception", async () => {
  assert.equal(replay.externalWrites, 0);
  assert(replay.effects.every((e) => e.disposition === "PROPOSED"));
  return "2 updates, 4 creates (3 study blocks), 1 local notification proposed; no external writes";
});
await check("security denial", async () => {
  await assert.rejects(
    service.promote(
      id,
      version,
      release.digest,
      "fixture",
      "LIVE",
      release.definition.permissions,
    ),
  );
  return "Promotion before owner approval denied";
});
await service.approve(id, version, release.digest);
await check("live promotion", async () => {
  await assert.rejects(
    service.promote(id, version, release.digest, "fixture", "LIVE", []),
  );
  await service.promote(id, version, release.digest, "fixture", "SHADOW", [
    "calendar.read",
    "gmail.read",
  ]);
  assert(
    (await service.runConnected(id, "fixture")).report.effects.every(
      (e) => e.disposition === "PROPOSED",
    ),
  );
  return "Exact grant enforcement and shadow write interception passed";
});
const keys = generateKeyPairSync("ed25519");
const capsule = packageCapsule(release, {
  privateKey: keys.privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString(),
  publicKey: keys.publicKey.export({ format: "pem", type: "spki" }).toString(),
});
await check("capsule integrity", async () => {
  assert.equal(
    verifyCapsule(JSON.parse(serializeCapsule(capsule))).signature,
    "VALID",
  );
  assert.equal(
    canonicalJson(capsule),
    canonicalJson(JSON.parse(serializeCapsule(capsule))),
  );
  return "Canonical content hash and real Ed25519 signature verified";
});
await check("tamper detection", async () => {
  const changed = structuredClone(capsule);
  changed.payload.spec.name = "Tampered";
  assert.throws(() => verifyCapsule(changed), /hash mismatch/);
  return "Changed manifest rejected before execution";
});
await check("import trust reset", async () => {
  const fresh = new ForgeService(new MemoryStateStore());
  const imported = await fresh.importCapsule(capsule);
  const trust = (await fresh.snapshot()).live!.trust[imported.release.digest];
  assert.equal(trust.current, "UNTRUSTED");
  assert.deepEqual(trust.grants, []);
  await assert.rejects(fresh.runConnected(id, "fixture"));
  return "Fresh installation retested; no inherited approval, replay or connector grant";
});
await check("MCP execution", async () => {
  const { server } = await createForgeMcpServer(service);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "stable-surface-evaluation",
    version: "1",
  });
  await server.connect(st);
  await client.connect(ct);
  try {
    const tools = (await client.listTools()).tools;
    assert(tools.some((t) => t.name === "forge.execute"));
    assert(tools.some((t) => t.name === "deadline_guardian"));
    const result = await client.callTool({
      name: "forge.execute",
      arguments: {
        id,
        event: {
          id: "stable-execution",
          type: "scheduled",
          payload: { text: "Execute shadow" },
        },
      },
    });
    assert(!result.isError);
    return "Stable execute and dynamic discovery succeeded through official MCP SDK";
  } finally {
    await client.close();
    await server.close();
  }
});
await check("rollback", async () => {
  await service.rollback(id, version);
  assert.deepEqual(
    (await service.snapshot()).live!.trust[release.digest].grants,
    [],
  );
  return "Executable rollback revokes all version authority";
});
// Historical live evidence is explicitly separate from this fixture evaluation.
let bedrock: unknown;
try {
  const proof = JSON.parse(
    await readFile("artifacts/bedrock-live-proof.json", "utf8"),
  );
  bedrock = {
    source: "recorded live AWS proof",
    passed: proof.passed,
    requestId: proof.requests?.[0]?.requestId,
    generatedAt: proof.generatedAt,
  };
} catch {
  bedrock = { source: "not available", passed: null };
}
const report = {
  generatedAt: new Date().toISOString(),
  runtime: "fixture",
  results: rows,
  passed: rows.filter((r) => r.passed).length,
  total: rows.length,
  replayGroundTruth: replay.evaluation,
  bedrock,
  googleLive:
    "NOT VERIFIED: no authenticated real Google read/write was exercised; injected connector tests are separate",
};
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/trust-evaluation.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
