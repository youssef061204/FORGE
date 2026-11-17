import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { IsolatedSandbox } from "../src/forge/sandbox";
import { DevelopmentEnvironmentModel } from "../src/forge/city-model";
import { GoogleConnection } from "../src/forge/connectors";
import { SecretVault } from "../src/forge/vault";
import { createCity } from "../src/forge/city-engine";
import { digest } from "../src/forge/hash";
import { verifyPassport } from "../src/forge/city-lab";
import { createForgeMcpServer } from "../src/forge/mcp-registry";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const store = new MemoryStateStore();
process.env.FORGE_FUTURES_MODE ??= "exhaustive";
await store.transaction((s) => {
  s.city = createCity(81023);
});
const observedRequests: string[] = [];
const fixture = new DevelopmentEnvironmentModel();
const service = new ForgeService(
  store,
  undefined,
  new IsolatedSandbox(),
  new GoogleConnection(new SecretVault("./artifacts/lab-proof-vault")),
  {
    async generate(...args) {
      observedRequests.push(args[0]);
      return fixture.generate(args[0], args[1], args[2], args[3]);
    },
  },
);
const { server, registry } = await createForgeMcpServer(service);
const client = new Client({
  name: "FORGE voice and Futures Lab proof",
  version: "1.0.0",
});
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(b);
await client.connect(a);
async function tool(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args }, undefined, {
    timeout: 240000,
  });
  assert(!result.isError, JSON.stringify(result.content));
  return JSON.parse((result.content as { text: string }[])[0].text);
}
async function contest(id: string) {
  const deadline = Date.now() + 240000;
  for (;;) {
    const current = (await store.read()).contests!.find((c) => c.id === id)!;
    if (["review", "reused", "failed"].includes(current.status)) {
      assert.equal(current.status, "review", current.error);
      return current;
    }
    assert(Date.now() < deadline, "Contest timeout");
    await new Promise((r) => setTimeout(r, 80));
  }
}
async function experiment(id: string) {
  const deadline = Date.now() + 180000;
  for (;;) {
    const current = (await service.lab.snapshot()).reports.find(
      (r) => r.id === id,
    )!;
    if (current.status !== "running") {
      assert.equal(current.status, "complete", current.error);
      return current;
    }
    assert(Date.now() < deadline, "Experiment timeout");
    await new Promise((r) => setTimeout(r, 80));
  }
}
try {
  const t0 = (await client.listTools()).tools.map((t) => t.name);
  for (const name of [
    "forge.mission",
    "forge.rehearse",
    "forge.evidence",
    "forge.briefing",
  ])
    assert(t0.includes(name));
  const job = await tool("forge.mission", {
    request:
      "Fixture mission: preserve hospital power and compare energy, exposure and congestion.",
    followUp: false,
  });
  const initial = await contest(job.contestId);
  console.log(
    "Measured City compilation complete; verifying owner challenge and experimental pairs.",
  );
  const release = (await store.read()).releases.find(
    (r) => r.digest === initial.releaseDigest,
  )!;
  const challenge = (await service.lab.command({
    action: "arm",
    contestId: initial.id,
    digest: release.digest,
  })) as { code: string };
  const admission = (await service.lab.command({
    action: "confirm",
    code: challenge.code,
  })) as { status: string };
  assert.equal(admission.status, "success");
  await assert.rejects(
    service.lab.command({ action: "confirm", code: challenge.code }),
    /consumed/,
  );
  await registry.sync();
  const t1 = (await client.listTools()).tools.map((t) => t.name);
  assert(!t0.includes(release.definition.toolContract.name));
  assert(t1.includes(release.definition.toolContract.name));
  const invoked = await tool(release.definition.toolContract.name, {
    eventId: "lab-proof-invoke",
    text: "Invoke approved policy",
  });
  assert.equal(invoked.status, "success");
  const parentHash = digest((await store.read()).city);
  const reports = [];
  for (const kind of ["what-if", "chaos", "ablation"] as const) {
    const started = await tool("forge.rehearse", {
      digest: release.digest,
      kind,
      ...(kind === "what-if"
        ? { change: { operation: "weather.set", rain: 0.95, wind: 0.9 } }
        : {}),
      ...(kind === "ablation" ? { operation: "signal.set" } : {}),
    });
    const report = await experiment(started.reportId);
    assert.equal(report.rows.length, 20);
    assert.equal(digest((await store.read()).city), parentHash);
    assert(
      report.rows.every(
        (r) => r.seed === r.baseline.seed && r.seed === r.treatment.seed,
      ),
    );
    reports.push(report);
    console.log(
      kind +
        ": " +
        report.rows.length +
        " measured pairs; authoritative City unchanged.",
    );
  }
  const signed = await tool("forge.evidence", { contestId: initial.id });
  assert.equal(verifyPassport(signed.passport).integrity, "VALID");
  assert.throws(
    () =>
      verifyPassport({
        ...signed.passport,
        payload: { ...signed.passport.payload, failures: 10 },
      }),
    /invalid/,
  );
  assert(!JSON.stringify(signed.passport).includes(initial.request));
  const briefing = await tool("forge.briefing", {});
  assert(briefing.text.includes("95 percent Wilson"));
  const evidence = await tool("forge.evidence", {});
  assert(
    evidence.uncertainty.every(
      (c: { interval: { upper: number } }) => c.interval.upper > 0,
    ),
  );
  assert.equal(
    new Set(initial.candidates[0].frames.map((f) => f.seed)).size,
    3,
  );
  assert(
    initial.candidates.every((c) =>
      c.frames.every((f) => f.nodes?.length === 48),
    ),
  );
  const nextJob = await tool("forge.mission", {
    request:
      "Also dispatch responders to active incidents while preserving all prior safety constraints.",
    followUp: true,
  });
  const extension = await contest(nextJob.contestId);
  assert(observedRequests.at(-1)!.includes("Owner conversation context"));
  assert(observedRequests.at(-1)!.includes("hospitalPower"));
  const extended = (await store.read()).releases.find(
    (r) => r.digest === extension.releaseDigest,
  )!;
  assert.equal(extended.definition.version, "1.1.0");
  assert.equal(extended.definition.parentVersion, "1.0.0");
  assert.equal(extension.candidates.length, 4);
  assert.equal(
    (await service.city.approve(extension.id, extended.digest)).status,
    "success",
  );
  const capsule = await service.exportCapsule(
    extended.definition.id,
    extended.definition.version,
  );
  assert(!JSON.stringify(capsule).includes("Also dispatch responders"));
  const imported = (await service.importCapsule(capsule)).release;
  assert.equal(
    (await store.read()).live!.trust[imported.digest].current,
    "UNTRUSTED",
  );
  assert.equal(
    (await store.read()).live!.trust[imported.digest].grants.length,
    0,
  );
  await assert.rejects(
    service.approve(
      imported.definition.id,
      imported.definition.version,
      imported.digest,
    ),
    /Futures|futures/,
  );
  const importJob = await service.city.reviewImported(imported.digest);
  const importContest = await contest(importJob.contestId);
  assert.equal(importContest.candidates[0].rollouts.length, 20);
  assert.equal(
    (await service.city.approve(importContest.id, imported.digest)).status,
    "success",
  );
  const checkpoint = (await service.lab.command({
    action: "checkpoint",
    name: "Verified policy checkpoint",
  })) as { id: string };
  await service.city.control({
    operation: "weather.set",
    rain: 0.85,
    wind: 0.8,
  });
  await service.lab.command({ action: "restore", id: checkpoint.id });
  const restored = (await store.read()).city!;
  assert(restored.paused);
  assert(!restored.deployment);
  const restoredState = await store.read();
  assert(
    restoredState.releases
      .filter((r) => r.definition.executable?.interface === "city/v1")
      .every(
        (r) =>
          restoredState.live!.trust[r.digest].grants.length === 0 &&
          restoredState.live!.trust[r.digest].current === "REVOKED",
      ),
  );
  const old = await service.rollback(extended.definition.id, "1.0.0");
  assert.equal(old.definition.version, "1.0.0");
  assert(!(await store.read()).city!.deployment);
  const proof = {
    passed: true,
    at: new Date().toISOString(),
    mode: "fixture",
    model:
      "Explicit development model double; not natural-language Bedrock proof",
    features: {
      missionMemory: { contextRetained: true, turns: 2 },
      spokenApproval: {
        exactDigest: true,
        oneUseReplayRejected: true,
        physicalMicrophoneVerified: false,
      },
      narration: {
        measuredTranscript: briefing.text,
        provider: briefing.provider,
        physicalSpeakerVerified: false,
      },
      whatIf: reports[0],
      chaos: reports[1],
      ablation: reports[2],
      uncertainty: evidence.uncertainty,
      passport: signed,
      checkpoint: {
        revokedEveryCityGrant: true,
        paused: restored.paused,
        externalServicesRewound: false,
      },
      arena: {
        sharedSeeds: 3,
        framesPerCandidate: 12,
        capturedSignalState: true,
      },
    },
    versions: {
      extended: extended.definition.version,
      parent: extended.definition.parentVersion,
      comparedCandidates: extension.candidates.length,
      sourceChanged:
        extended.definition.executable!.source !==
        release.definition.executable!.source,
      rolledBackTo: old.definition.version,
    },
    capsule: {
      signature: capsule.signature.provider,
      importedWithoutGrants: true,
      localRollouts: 20,
      ownerApprovedExecution: true,
    },
    t0,
    t1,
    installedTool: release.definition.toolContract.name,
    invocation: invoked.status,
    currentCityUnchangedDuringExperiments: true,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/lab-proof.json",
    JSON.stringify(proof, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: true,
      path: "artifacts/lab-proof.json",
      features: 10,
      measuredPairs: reports.reduce((n, r) => n + r.rows.length, 0),
      extended: extended.definition.version,
      importedLocalRollouts: 20,
    }),
  );
} finally {
  await client.close();
  await server.close();
}
