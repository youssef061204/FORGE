import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  BedrockRuntimeClient,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";
import {
  BedrockModelProvider,
  createBedrockRuntimeClient,
} from "../src/forge/models";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { scoutRequest, postings } from "../src/forge/fixtures";
import { createForgeMcpServer } from "../src/forge/mcp-registry";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { executionSchema, releaseSchema } from "../src/forge/records";
import { validateCapability } from "../src/forge/spec";
import { getConfig } from "../src/forge/config";
import { worldRequests, energyKw } from "../src/forge/world";
import { guardianRequest } from "../src/forge/replay-fixtures";
import { digest } from "../src/forge/hash";
import { meteredClient } from "./ml/paid-budget";
import { assertPaidActionAllowed } from "../src/forge/cost-policy";

// Fail before credential resolution and before the finally block can overwrite
// historical live evidence with an attempted proof that policy forbids.
assertPaidActionAllowed("Live Amazon Bedrock verification");

const isWorldProof = process.env.FORGE_VERIFY_DOMAIN === "world";
const isLiveProof = process.env.FORGE_VERIFY_DOMAIN === "live";
const expectedTool = isLiveProof
  ? "deadline_guardian"
  : isWorldProof
    ? "leaving_home"
    : "internship_scout";

type RequestEvidence = {
  operation: "Converse";
  durationMs: number;
  succeeded: boolean;
  requestId?: string;
  httpStatusCode?: number;
  errorName?: string;
  errorMessage?: string;
};
const requests: RequestEvidence[] = [];

// Account-backed proof: never substitute the deterministic planner after a cloud failure.
const proof: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  provider: "bedrock",
  domain: isLiveProof
    ? "live-executable"
    : isWorldProof
      ? "world"
      : "internship",
  profile: process.env.AWS_PROFILE ?? null,
  runtimeMode: process.env.FORGE_RUNTIME_MODE ?? null,
  region: process.env.AWS_REGION ?? null,
  modelId: process.env.BEDROCK_MODEL_ID ?? null,
  credentialsResolved: false,
  requestSucceeded: false,
  schemaValidationPassed: false,
  requests,
  passed: false,
  transport:
    "Official MCP SDK linked in-memory transports; HTTP proof is separate",
  externalData: "fixtures",
  approval: "isolated automated test harness",
};
const start = performance.now();
let runtime: BedrockRuntimeClient | undefined;
try {
  const config = getConfig();
  assert.equal(config.FORGE_RUNTIME_MODE, "aws", "Set FORGE_RUNTIME_MODE=aws");
  assert.equal(config.MODEL_PROVIDER, "bedrock");
  assert(
    process.env.AWS_PROFILE,
    "Set AWS_PROFILE to your authenticated profile",
  );
  assert(process.env.AWS_REGION, "Set AWS_REGION to your authorized region");
  assert(
    process.env.BEDROCK_MODEL_ID,
    "Set BEDROCK_MODEL_ID to an authorized model or inference profile",
  );
  runtime = process.argv.includes("--budget")
    ? await meteredClient()
    : createBedrockRuntimeClient();
  runtime.middlewareStack.add(
    (next, context) => async (args) => {
      assert.equal(context.commandName, "ConverseCommand");
      assert.equal(
        requests.length,
        0,
        "Live verification permits one Bedrock request; invalid output is not retried",
      );
      const request: RequestEvidence = {
        operation: "Converse",
        durationMs: 0,
        succeeded: false,
      };
      requests.push(request);
      const started = performance.now();
      try {
        const result = await next(args);
        const output = result.output as ConverseCommandOutput;
        request.requestId = output.$metadata.requestId;
        request.httpStatusCode = output.$metadata.httpStatusCode;
        request.succeeded = output.$metadata.httpStatusCode === 200;
        proof.requestSucceeded = request.succeeded;
        return result;
      } catch (error) {
        // Persist only selected AWS error fields, never HTTP headers, credentials,
        // request inputs, raw output, or the complete SDK exception object.
        if (error instanceof Error) {
          request.errorName = error.name;
          request.errorMessage = error.message;
          if ("$metadata" in error) {
            const metadata =
              error.$metadata as ConverseCommandOutput["$metadata"];
            request.requestId = metadata.requestId;
            request.httpStatusCode = metadata.httpStatusCode;
          }
        }
        throw error;
      } finally {
        request.durationMs = Math.round(performance.now() - started);
        proof.requestDurationMs = request.durationMs;
      }
    },
    { name: "forgeLiveBedrockEvidence", step: "initialize" },
  );
  runtime.middlewareStack.add(
    (next) => async (args) => {
      // The SDK signing stage has resolved credentials before HTTP dispatch.
      // Do not access or print the credential object.
      proof.credentialsResolved = true;
      return next(args);
    },
    { name: "forgeSignedRequestReachedTransport", step: "deserialize" },
  );
  const service = new ForgeService(
    new MemoryStateStore(),
    new BedrockModelProvider(
      process.env.BEDROCK_MODEL_ID,
      runtime,
      1,
      isLiveProof
        ? async (cap) => {
            if (cap.executable) {
              await mkdir("artifacts", { recursive: true });
              await writeFile(
                "artifacts/bedrock-live-candidate.ts",
                cap.executable.source,
                { mode: 0o600 },
              );
            }
          }
        : undefined,
    ),
  );
  const { server, registry } = await createForgeMcpServer(service);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "live-bedrock-proof", version: "1" });
  await server.connect(st);
  await client.connect(ct);
  try {
    proof.before = (await client.listTools()).tools.map((tool) => tool.name);
    assert(!(proof.before as string[]).includes(expectedTool));
    const build = await client.callTool(
      {
        name: "forge.build",
        arguments: {
          request: isLiveProof
            ? guardianRequest
            : isWorldProof
              ? worldRequests.leaving
              : scoutRequest,
        },
      },
      undefined,
      { timeout: 120000 },
    );
    assert(
      !build.isError,
      requests[0]?.errorMessage ??
        (build.content as { text: string }[])?.[0]?.text ??
        "FORGE capability compilation failed",
    );
    assert.equal(requests.length, 1);
    assert.equal(proof.requestSucceeded, true);
    const release = releaseSchema.parse(
      (await service.store.read()).releases.at(-1),
    );
    validateCapability(release.definition);
    proof.schemaValidationPassed = true;
    proof.admissionChecks = release.report.checks.map((check) => ({
      name: check.name,
      category: check.category,
      passed: check.passed,
      details: check.details,
    }));
    assert(
      release.report.passed,
      "Bedrock-generated release must pass all runtime checks",
    );
    assert.equal(release.usage.model, process.env.BEDROCK_MODEL_ID);
    assert(
      release.usage.inputTokens > 0 && release.usage.outputTokens > 0,
      "Cloud proof requires actual response token usage",
    );
    assert(
      release.usage.requestIds?.length,
      "Cloud proof requires an AWS response request ID",
    );
    assert.deepEqual(
      release.usage.requestIds,
      requests.map((r) => r.requestId),
    );
    proof.compilation = {
      digest: release.digest,
      usage: release.usage,
      checks: release.report.checks.length,
      schemaValidationPassed: true,
      resolution: release.resolution,
      executableSourceHash: release.definition.executable
        ? digest(release.definition.executable.source)
        : undefined,
    };
    assert(
      !(await client.listTools()).tools.some(
        (tool) => tool.name === release.definition.toolContract.name,
      ),
      "Unapproved generated capability must not be installed",
    );
    if (isLiveProof) {
      assert(
        release.definition.executable,
        "Bedrock must generate actual executable source",
      );
      const replay = await service.replay(
        release.definition.id,
        release.definition.version,
        release.digest,
        "fixture",
      );
      assert(replay.passed && replay.externalWrites === 0);
      assert.equal(replay.evaluation?.exactMatches, 8);
      proof.replay = replay;
    }
    await service.approve(
      release.definition.id,
      release.definition.version,
      release.digest,
    );
    if (isLiveProof)
      await service.promote(
        release.definition.id,
        release.definition.version,
        release.digest,
        "fixture",
        "SHADOW",
        ["calendar.read", "gmail.read"],
      );
    await registry.sync();
    proof.after = (await client.listTools()).tools.map((tool) => tool.name);
    assert(
      (proof.after as string[]).includes(release.definition.toolContract.name),
      "Approved capability must be discoverable",
    );
    const worldBefore = (await service.snapshot()).world;
    const result = await client.callTool({
      name: release.definition.toolContract.name,
      arguments:
        isWorldProof || isLiveProof
          ? {
              eventId: "bedrock-world-proof",
              text: "Apply the approved leaving routine.",
            }
          : { eventId: "bedrock-proof", jobPosting: postings.amd },
    });
    assert(!result.isError);
    const execution = executionSchema.parse(result.structuredContent);
    assert.equal(execution.status, "success", execution.error);
    proof.execution = {
      status: execution.status,
      traceSteps: execution.trace.length,
      sandbox: execution.sandbox,
    };
    if (isWorldProof) {
      const worldAfter = (await service.snapshot()).world;
      assert.equal(worldAfter.presence, "away");
      assert.equal(worldAfter.doorLocked, true);
      assert.equal(worldAfter.computerOn, false);
      assert.equal(worldAfter.appliancesOn, false);
      assert(Object.values(worldAfter.lights).every((on) => !on));
      assert(energyKw(worldAfter) < energyKw(worldBefore));
      proof.world = {
        before: worldBefore,
        after: worldAfter,
        energyBeforeKw: energyKw(worldBefore),
        energyAfterKw: energyKw(worldAfter),
      };
    }
    proof.passed = true;
  } finally {
    await client.close();
    await server.close();
  }
} catch (error) {
  proof.error =
    error instanceof Error ? error.message : "Live Bedrock verification failed";
  process.exitCode = 1;
} finally {
  runtime?.destroy();
  proof.latencyMs = Math.round(performance.now() - start);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    isLiveProof
      ? "artifacts/bedrock-live-proof.json"
      : isWorldProof
        ? "artifacts/bedrock-world-proof.json"
        : "artifacts/bedrock-proof.json",
    JSON.stringify(proof, null, 2),
  );
  console.log(JSON.stringify(proof, null, 2));
}
