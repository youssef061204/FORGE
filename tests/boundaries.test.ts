import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assertAccess, readJson, HttpAccessError } from "../src/forge/http";
import { configSchema } from "../src/forge/config";
import {
  DynamoStateStore,
  EventBridgeEventBus,
  CloudWatchAuditSink,
} from "../src/forge/aws";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";

describe("HTTP and environment boundaries", () => {
  it("defaults to fixture, selects real Bedrock in aws mode, and rejects conflicting modes", () => {
    expect(configSchema.parse({})).toMatchObject({
      FORGE_RUNTIME_MODE: "fixture",
      MODEL_PROVIDER: "demo",
    });
    expect(
      configSchema.parse({
        FORGE_FREE_ONLY: "false",
        FORGE_RUNTIME_MODE: "aws",
        BEDROCK_MODEL_ID: "configured-model",
      }),
    ).toMatchObject({ FORGE_RUNTIME_MODE: "aws", MODEL_PROVIDER: "bedrock" });
    expect(configSchema.safeParse({ FORGE_RUNTIME_MODE: "aws" }).success).toBe(
      false,
    );
    expect(
      configSchema.safeParse({
        FORGE_RUNTIME_MODE: "aws",
        MODEL_PROVIDER: "demo",
        BEDROCK_MODEL_ID: "model",
      }).success,
    ).toBe(false);
    expect(
      configSchema.safeParse({
        FORGE_RUNTIME_MODE: "fixture",
        MODEL_PROVIDER: "bedrock",
        BEDROCK_MODEL_ID: "model",
      }).success,
    ).toBe(false);
  });
  it("returns an authentication error distinct from origin rejection", () => {
    vi.stubEnv("FORGE_API_TOKEN", "test-token-with-at-least-24-characters");
    try {
      try {
        assertAccess(new Request("http://localhost/api/mcp"));
        throw new Error("Missing token was accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpAccessError);
        expect((error as HttpAccessError).status).toBe(401);
      }
      expect(() =>
        assertAccess(
          new Request("http://localhost/api/mcp", {
            headers: {
              Authorization: "Bearer test-token-with-at-least-24-characters",
            },
          }),
        ),
      ).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("rejects hostile origin while accepting normalized local host", () => {
    expect(() =>
      assertAccess(
        new Request("http://localhost:3001/api/mcp", {
          headers: { Host: "127.0.0.1:3001", Origin: "http://127.0.0.1:3001" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertAccess(
        new Request("http://localhost:3001/api/mcp", {
          headers: {
            Host: "127.0.0.1:3001",
            Origin: "https://attacker.example",
          },
        }),
      ),
    ).toThrow(/Cross-origin/);
  });
  it("blocks non-loopback without token", () =>
    expect(() =>
      assertAccess(new Request("https://forge.example/api/mcp")),
    ).toThrow(/Non-loopback/));
  it("enforces body size even without content-length", async () => {
    const request = new Request("http://localhost/api", {
      method: "POST",
      body: JSON.stringify({ text: "a".repeat(70000) }),
    });
    await expect(readJson(request)).rejects.toThrow(/too large/);
  });
  it("requires configured cloud model and refuses unlabeled fixture operation", () => {
    expect(configSchema.safeParse({ MODEL_PROVIDER: "bedrock" }).success).toBe(
      false,
    );
    expect(configSchema.safeParse({ DEMO_MODE: "false" }).success).toBe(false);
  });
});
describe("AWS adapter SDK contracts (injected clients, no cloud claims)", () => {
  beforeEach(() => vi.stubEnv("FORGE_FREE_ONLY", "false"));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  it("writes validated DynamoDB state with optimistic concurrency", async () => {
    const client = DynamoDBDocumentClient.from(
      new (await import("@aws-sdk/client-dynamodb")).DynamoDBClient({
        region: "us-east-1",
      }),
    );
    const send = vi.spyOn(client, "send").mockImplementation(async () => ({}));
    const store = new DynamoStateStore("test", client);
    await store.transaction((s) => {
      s.audit.push({
        at: "now",
        action: "test",
        capabilityId: "test",
        details: "verified",
      });
    });
    const command = send.mock.calls[1][0];
    expect(command.input).toMatchObject({
      ConditionExpression: "attribute_not_exists(pk)",
      TableName: "test",
    });
  });
  it("fails EventBridge publishing when service rejects event", async () => {
    const client = new EventBridgeClient({ region: "us-east-1" });
    vi.spyOn(client, "send").mockImplementation(async () => ({
      FailedEntryCount: 1,
      Entries: [{ ErrorCode: "AccessDeniedException" }],
    }));
    await expect(
      new EventBridgeEventBus("test", client).publish("scout", {
        id: "evt",
        type: "manual",
        payload: {},
      }),
    ).rejects.toThrow(/rejected/);
  });
  it("exports structured audit data to CloudWatch", async () => {
    const client = new CloudWatchLogsClient({ region: "us-east-1" });
    const send = vi.spyOn(client, "send").mockImplementation(async () => ({}));
    await new CloudWatchAuditSink("test", client).write("installed", {
      id: "cap",
    });
    expect(send.mock.calls[0][0].input).toMatchObject({
      logGroupName: "test",
      logStreamName: "forge",
    });
  });
});
