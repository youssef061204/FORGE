import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { createForgeMcpServer } from "../src/forge/mcp-registry";
import { IsolatedSandbox } from "../src/forge/sandbox";
import { DemoModelProvider, BedrockModelProvider } from "../src/forge/models";
import { GoogleConnection } from "../src/forge/connectors";
import {
  BedrockEnvironmentModel,
  DevelopmentEnvironmentModel,
} from "../src/forge/city-model";
import { createCity } from "../src/forge/city-engine";
import { meteredClient } from "./ml/paid-budget";
import { assertPaidActionAllowed } from "../src/forge/cost-policy";
const aws = process.argv.includes("--aws");
if (aws) assertPaidActionAllowed("Live Amazon Bedrock Twin verification");
// Retain the original T0/T1 proof budget; adaptive allocation has its own benchmark.
process.env.FORGE_FUTURES_MODE ??= "exhaustive";
if (aws) {
  process.env.FORGE_RUNTIME_MODE = "aws";
  process.env.AWS_PROFILE ??= "forge";
  process.env.AWS_REGION ??= "ca-central-1";
  process.env.BEDROCK_MODEL_ID ??=
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
}
const model = process.env.BEDROCK_MODEL_ID!;
const store = new MemoryStateStore();
await store.transaction((s) => {
  s.city = createCity(823410);
});
const service = new ForgeService(
  store,
  aws ? new BedrockModelProvider(model) : new DemoModelProvider(),
  new IsolatedSandbox(),
  new GoogleConnection(),
  aws
    ? new BedrockEnvironmentModel(
        model,
        process.argv.includes("--budget") ? await meteredClient() : undefined,
      )
    : new DevelopmentEnvironmentModel(),
);
const { server, registry } = await createForgeMcpServer(service);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({
  name: "FORGE City independent MCP proof",
  version: "1.0.0",
});
await server.connect(serverTransport);
await client.connect(clientTransport);
try {
  const t0 = (await client.listTools()).tools.map((t) => t.name);
  const response = await client.callTool({
    name: "forge.goal",
    arguments: {
      request:
        "Reduce traffic congestion and energy demand, preserve hospital power at least 90 percent, and keep evacuation routes safe. Build independently different algorithms using the available city resources. Ask approval before acting.",
    },
  });
  assert(!response.isError, JSON.stringify(response.content));
  const job = JSON.parse((response.content as { text: string }[])[0].text) as {
    contestId: string;
  };
  const deadline = Date.now() + 300000;
  let state = await store.read();
  while (
    !["review", "failed", "reused"].includes(
      state.contests!.find((c) => c.id === job.contestId)!.status,
    )
  ) {
    assert(Date.now() < deadline, "City compilation timed out");
    await new Promise((resolve) => setTimeout(resolve, 100));
    state = await store.read();
  }
  const contest = state.contests!.find((c) => c.id === job.contestId)!;
  if (contest.status === "failed") {
    await mkdir("artifacts", { recursive: true });
    await writeFile(
      aws
        ? "artifacts/bedrock-city-failure.json"
        : "artifacts/city-failure.json",
      JSON.stringify(contest, null, 2) + "\n",
    );
    console.error(
      JSON.stringify(
        {
          error: contest.error,
          candidates: contest.candidates.map((c) => ({
            status: c.status,
            checks: c.checks,
            firstFailure: c.rollouts.find(
              (r) => r.error || r.violations.length,
            ),
          })),
        },
        null,
        2,
      ),
    );
  }
  assert.equal(
    contest.status,
    "review",
    contest.error ?? contest.interpretation,
  );
  assert.equal(new Set(contest.candidates.map((c) => c.hash)).size, 3);
  assert.equal(contest.baseline.length, 20);
  assert.equal(
    contest.candidates.filter((c) => c.rollouts.length === 20).length,
    3,
  );
  const winner = contest.candidates.find((c) => c.id === contest.winner)!;
  assert.equal(winner.summary!.constraintViolations, 0);
  const release = state.releases.find(
    (r) => r.digest === contest.releaseDigest,
  )!;
  assert(release.report.passed);
  assert(!t0.includes(release.definition.toolContract.name));
  assert(
    !(await client.listTools()).tools.some(
      (t) => t.name === release.definition.toolContract.name,
    ),
  );
  // Prove admission applies to the evolving current world, not the evaluated snapshot.
  await service.city.control({
    operation: "weather.set",
    rain: 0.23,
    wind: 0.3,
  });
  const revisionBeforeApproval = (await service.city.provider.observe())
    .revision;
  const admitted = await service.city.approve(contest.id, release.digest);
  assert.equal(admitted.status, "success", admitted.error);
  await registry.sync();
  const t1 = (await client.listTools()).tools.map((t) => t.name);
  assert(t1.includes(release.definition.toolContract.name));
  const invocation = await client.callTool({
    name: release.definition.toolContract.name,
    arguments: {
      eventId: "city-proof-tool-call",
      text: "Execute the installed algorithm against the current authoritative digital twin",
    },
  });
  assert(!invocation.isError, JSON.stringify(invocation.content));
  const execution = JSON.parse(
    (invocation.content as { text: string }[])[0].text,
  );
  assert.equal(execution.status, "success");
  const after = await service.city.provider.observe();
  assert(after.revision >= revisionBeforeApproval);
  assert.equal(after.weather.rain, 0.23);
  if (aws) {
    assert(
      contest.providerEvidence?.every(
        (e) =>
          e.provider === "Amazon Bedrock" &&
          e.schemaValid &&
          e.requestIds.length > 0 &&
          e.region === "ca-central-1" &&
          e.profile === "forge",
      ),
    );
  }
  const proof = {
    passed: true,
    at: new Date().toISOString(),
    mode: aws ? "aws" : "fixture",
    providerEvidence: contest.providerEvidence,
    snapshotHash: contest.snapshotHash,
    candidateHashes: contest.candidates.map((c) => ({
      name: c.name,
      hash: c.hash,
      algorithmHash: c.algorithmHash,
      source: c.source,
      attempts: c.attempts,
      status: c.status,
      rollouts: c.rollouts.length,
      summary: c.summary,
    })),
    seeds: contest.seeds,
    baseline: contest.baseline,
    winner: winner.id,
    releaseDigest: release.digest,
    schemaValidated: true,
    goalContract: contest.goal,
    validation: release.report,
    t0,
    t1,
    execution,
    currentWorldPreserved: {
      revisionBeforeApproval,
      revisionAfter: after.revision,
      rain: after.weather.rain,
    },
    physicalConnection: false,
  };
  await mkdir("artifacts", { recursive: true });
  const path = aws
    ? "artifacts/bedrock-city-proof.json"
    : "artifacts/city-proof.json";
  await writeFile(path, JSON.stringify(proof, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        passed: proof.passed,
        mode: proof.mode,
        path,
        candidateRollouts: proof.candidateHashes.map((c) => c.rollouts),
        sourceHashes: proof.candidateHashes.map((c) => c.hash),
        providerEvidence: proof.providerEvidence,
        installedTool: release.definition.toolContract.name,
        execution: execution.status,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  await server.close();
}
