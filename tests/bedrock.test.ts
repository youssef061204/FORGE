import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AccessDeniedException,
  BedrockRuntimeClient,
} from "@aws-sdk/client-bedrock-runtime";
import { BedrockModelProvider } from "../src/forge/models";
import { demoPlan } from "../src/forge/compiler";
import { scoutRequest } from "../src/forge/fixtures";

const response = (text: string, id = "injected-response-id") => ({
  output: { message: { role: "assistant", content: [{ text }] } },
  usage: { inputTokens: 100, outputTokens: 200 },
  $metadata: { requestId: id },
});
describe("Bedrock compilation boundary (injected SDK responses, not live AWS)", () => {
  // These tests always replace SDK send; opting out exercises the dormant
  // adapter contract without permitting a real request in the test harness.
  beforeEach(() => vi.stubEnv("FORGE_FREE_ONLY", "false"));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  it("derives the trusted MCP contract and records actual response usage", async () => {
    const client = new BedrockRuntimeClient({ region: "us-east-1" });
    const cap = demoPlan(scoutRequest);
    cap.toolContract.inputSchema = { injected: "attacker-provided contract" };
    const send = vi
      .spyOn(client, "send")
      .mockImplementation(async () => response(JSON.stringify(cap)));
    const result = await new BedrockModelProvider(
      "test-model",
      client,
    ).generateStructured(scoutRequest);
    expect(result.value.toolContract.inputSchema).not.toHaveProperty(
      "injected",
    );
    expect(result.usage).toMatchObject({
      model: "test-model",
      inputTokens: 100,
      outputTokens: 200,
      requestIds: ["injected-response-id"],
      estimatedCost: null,
    });
    expect(send.mock.calls[0][0].input).toMatchObject({
      modelId: "test-model",
    });
    client.destroy();
  });
  it("retries invalid output once and accumulates both attempts' token usage", async () => {
    const client = new BedrockRuntimeClient({ region: "us-east-1" });
    const send = vi
      .spyOn(client, "send")
      .mockImplementationOnce(async () => response("not JSON", "first"))
      .mockImplementationOnce(async () =>
        response(JSON.stringify(demoPlan(scoutRequest)), "second"),
      );
    const result = await new BedrockModelProvider(
      "test-model",
      client,
    ).generateStructured(scoutRequest);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.usage).toMatchObject({
      inputTokens: 200,
      outputTokens: 400,
      requestIds: ["first", "second"],
    });
    client.destroy();
  });
  it("rejects model-generated permission escalation after the bounded retries", async () => {
    const client = new BedrockRuntimeClient({ region: "us-east-1" });
    const cap = demoPlan(scoutRequest);
    const send = vi.spyOn(client, "send").mockImplementation(async () =>
      response(
        JSON.stringify({
          ...cap,
          permissions: [...cap.permissions, "secrets.read"],
        }),
      ),
    );
    await expect(
      new BedrockModelProvider("test-model", client).generateStructured(
        scoutRequest,
      ),
    ).rejects.toThrow(/after two attempts/);
    expect(send).toHaveBeenCalledTimes(2);
    client.destroy();
  });
  it("propagates cloud authorization failures without substituting a demo workflow", async () => {
    const client = new BedrockRuntimeClient({ region: "us-east-1" });
    const error = new AccessDeniedException({
      message: "Anthropic use case details have not been submitted",
      $metadata: { httpStatusCode: 403, requestId: "injected-denial-id" },
    });
    const send = vi.spyOn(client, "send").mockRejectedValue(error);
    await expect(
      new BedrockModelProvider("test-model", client).generateStructured(
        scoutRequest,
      ),
    ).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    client.destroy();
  });
  it("rejects a model-generated cyclic DAG before accepting the capability", async () => {
    const client = new BedrockRuntimeClient({ region: "us-east-1" });
    const cap = demoPlan(scoutRequest);
    cap.nodes[0].dependsOn = [cap.nodes.at(-1)!.id];
    cap.edges.push({ from: cap.nodes.at(-1)!.id, to: cap.nodes[0].id });
    vi.spyOn(client, "send").mockImplementation(async () =>
      response(JSON.stringify(cap)),
    );
    await expect(
      new BedrockModelProvider("test-model", client).generateStructured(
        scoutRequest,
      ),
    ).rejects.toThrow(/after two attempts/);
    client.destroy();
  });
});
