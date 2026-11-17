import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { EventBridgeClient } from "@aws-sdk/client-eventbridge";
import type { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import type { KMSClient } from "@aws-sdk/client-kms";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Capsule } from "../src/forge/capsule";
import type { EnvironmentProvider } from "../src/forge/environment";
import type { City } from "../src/forge/city-contracts";
import {
  assertPaidActionAllowed,
  freeOnlyEnabled,
  FreeOnlyViolation,
} from "../src/forge/cost-policy";
import { configSchema } from "../src/forge/config";
import {
  BedrockModelProvider,
  createBedrockRuntimeClient,
} from "../src/forge/models";
import { BedrockEnvironmentModel } from "../src/forge/city-model";
import {
  CloudWatchAuditSink,
  DynamoStateStore,
  EventBridgeEventBus,
} from "../src/forge/aws";
import { signWithKms, storeCapsule } from "../src/forge/aws-artifacts";
import {
  BedrockMissionModel,
  type PlanningContext,
} from "../src/forge/product/provider";
import { secureFetch } from "../src/forge/product/network";

const credentialLookup = vi.hoisted(() => vi.fn());
const credentialFactory = vi.hoisted(() => vi.fn(() => credentialLookup));
vi.mock("@aws-sdk/credential-providers", async (original) => ({
  ...(await original<typeof import("@aws-sdk/credential-providers")>()),
  fromNodeProviderChain: credentialFactory,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("free-only cost boundary (no cloud calls)", () => {
  it("blocks external connector access before URL parsing, DNS or HTTP", async () => {
    vi.stubEnv("FORGE_FREE_ONLY", "true");
    await expect(secureFetch("not a URL", {}, [])).rejects.toThrow(
      /External connector network access.*pricing is unverified/,
    );
  });
  it("defaults to blocking and fails closed on malformed values", () => {
    expect(freeOnlyEnabled({})).toBe(true);
    for (const value of ["true", "", "0", "FALSE", "invalid"])
      expect(freeOnlyEnabled({ FORGE_FREE_ONLY: value })).toBe(true);
    vi.stubEnv("FORGE_FREE_ONLY", "true");
    expect(() => assertPaidActionAllowed("Paid inference")).toThrow(
      FreeOnlyViolation,
    );
    expect(configSchema.parse({})).toMatchObject({
      FORGE_FREE_ONLY: "true",
      FORGE_RUNTIME_MODE: "fixture",
      STORE_PROVIDER: "local",
    });
  });

  it.each([
    { FORGE_RUNTIME_MODE: "aws", BEDROCK_MODEL_ID: "test" },
    { MODEL_PROVIDER: "bedrock", BEDROCK_MODEL_ID: "test" },
    { STORE_PROVIDER: "dynamodb", DYNAMODB_TABLE: "test" },
    { FORGE_EVENT_BUS: "test" },
    { FORGE_LOG_GROUP: "test" },
    { FORGE_KMS_KEY_ID: "test" },
    { FORGE_ARTIFACT_BUCKET: "test" },
  ])(
    "rejects paid configuration %j before server initialization",
    (settings) => {
      const parsed = configSchema.safeParse(settings);
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(
          parsed.error.issues.some((issue) =>
            issue.message.includes("FORGE_FREE_ONLY=true"),
          ),
        ).toBe(true);
    },
  );

  it("blocks model/client construction before credential-provider creation", () => {
    vi.stubEnv("FORGE_FREE_ONLY", "true");
    expect(() => createBedrockRuntimeClient()).toThrow(FreeOnlyViolation);
    expect(() => new BedrockModelProvider("test")).toThrow(FreeOnlyViolation);
    expect(() => new BedrockEnvironmentModel("test")).toThrow(
      FreeOnlyViolation,
    );
    expect(() => new BedrockMissionModel()).toThrow(FreeOnlyViolation);
    expect(credentialFactory).not.toHaveBeenCalled();
    expect(credentialLookup).not.toHaveBeenCalled();
  });

  it("blocks state, event and audit adapters even with injected SDK clients", () => {
    vi.stubEnv("FORGE_FREE_ONLY", "true");
    const send = vi.fn();
    expect(
      () =>
        new DynamoStateStore("test", {
          send,
        } as unknown as DynamoDBDocumentClient),
    ).toThrow(FreeOnlyViolation);
    expect(
      () =>
        new EventBridgeEventBus("test", {
          send,
        } as unknown as EventBridgeClient),
    ).toThrow(FreeOnlyViolation);
    expect(
      () =>
        new CloudWatchAuditSink("test", {
          send,
        } as unknown as CloudWatchLogsClient),
    ).toThrow(FreeOnlyViolation);
    expect(send).not.toHaveBeenCalled();
  });

  it("rechecks policy on existing instances before reads, writes and model requests", async () => {
    // Every injected send is a local spy. No real credentials or transport exists.
    vi.stubEnv("FORGE_FREE_ONLY", "false");
    const send = vi.fn();
    const store = new DynamoStateStore("test", {
      send,
    } as unknown as DynamoDBDocumentClient);
    const bus = new EventBridgeEventBus("test", {
      send,
    } as unknown as EventBridgeClient);
    const audit = new CloudWatchAuditSink("test", {
      send,
    } as unknown as CloudWatchLogsClient);
    const model = new BedrockModelProvider("test", {
      send,
    } as unknown as BedrockRuntimeClient);
    const twin = new BedrockEnvironmentModel("test", {
      send,
    } as unknown as BedrockRuntimeClient);
    const product = new BedrockMissionModel();
    vi.stubEnv("FORGE_FREE_ONLY", "true");
    await expect(store.read()).rejects.toThrow(FreeOnlyViolation);
    await expect(store.transaction(() => undefined)).rejects.toThrow(
      FreeOnlyViolation,
    );
    await expect(
      bus.publish("test", { id: "test", type: "manual", payload: {} }),
    ).rejects.toThrow(FreeOnlyViolation);
    await expect(audit.write("test", {})).rejects.toThrow(FreeOnlyViolation);
    await expect(model.generateStructured("test")).rejects.toThrow(
      FreeOnlyViolation,
    );
    await expect(
      twin.generate("test", {} as EnvironmentProvider, {} as City),
    ).rejects.toThrow(FreeOnlyViolation);
    expect(await product.status()).toMatchObject({
      ready: false,
      label: "FREE MODE",
    });
    await expect(product.plan({} as PlanningContext)).rejects.toThrow(
      FreeOnlyViolation,
    );
    expect(credentialLookup).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("blocks KMS/S3 before signing, artifact validation or SDK dispatch", async () => {
    vi.stubEnv("FORGE_FREE_ONLY", "true");
    const send = vi.fn();
    await expect(
      signWithKms({} as Capsule, "test", { send } as unknown as KMSClient),
    ).rejects.toThrow(FreeOnlyViolation);
    await expect(
      storeCapsule({} as Capsule, "test", { send } as unknown as S3Client),
    ).rejects.toThrow(FreeOnlyViolation);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses paid proof entrypoints without overwriting historical evidence", async () => {
    const paths = [
      "artifacts/bedrock-proof.json",
      "artifacts/bedrock-live-proof.json",
      "artifacts/bedrock-world-proof.json",
      "artifacts/bedrock-city-proof.json",
      "artifacts/ml/paid-requests.json",
      "artifacts/ml/program-synthesis.json",
      "artifacts/product/openapi-public-proof.json",
    ];
    const hashes = () =>
      Promise.all(
        paths.map(async (path) => {
          try {
            return createHash("sha256")
              .update(await readFile(path))
              .digest("hex");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw error;
          }
        }),
      );
    const before = await hashes();
    for (const args of [
      ["scripts/verify-bedrock.ts"],
      ["scripts/verify-city.ts", "--aws"],
      ["scripts/ml/synthesis-benchmark.ts", "--live"],
      ["scripts/verify-product-public-read.ts"],
      ["scripts/verify-product-openapi.ts"],
    ]) {
      const result = await promisify(execFile)(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", ...args],
        {
          env: { ...process.env, FORGE_FREE_ONLY: "true" },
          timeout: 30000,
          windowsHide: true,
        },
      ).then(
        () => null,
        (error: Error & { stderr: string }) => error,
      );
      expect(result).not.toBeNull();
      expect(result?.stderr).toContain("FreeOnlyViolation");
    }
    expect(await hashes()).toEqual(before);
  });
});
