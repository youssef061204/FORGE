import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, sign, constants } from "node:crypto";
import { KMSClient } from "@aws-sdk/client-kms";
import { S3Client } from "@aws-sdk/client-s3";
import { signWithKms, storeCapsule } from "../src/forge/aws-artifacts";
import {
  packageCapsule,
  verifyCapsule,
  canonicalJson,
} from "../src/forge/capsule";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import { guardianRequest } from "../src/forge/replay-fixtures";
// Only injected, in-memory SDK send implementations are used in this file.
beforeEach(() => vi.stubEnv("FORGE_FREE_ONLY", "false"));
afterEach(() => vi.unstubAllEnvs());
it("KMS adapter sends a SHA-256 digest and public-key verification validates the returned RSA-PSS signature; S3 uses conditional content-addressed storage", async () => {
  const release = await new ForgeService(new MemoryStateStore()).propose(
    guardianRequest,
  );
  const local = generateKeyPairSync("ed25519");
  const capsule = packageCapsule(release, {
    privateKey: local.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    publicKey: local.publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
  });
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signature = sign(
    "sha256",
    Buffer.from(canonicalJson(capsule.payload)),
    {
      key: rsa.privateKey,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    },
  );
  const send = vi
    .fn()
    .mockResolvedValueOnce({
      PublicKey: rsa.publicKey.export({ format: "der", type: "spki" }),
      KeyUsage: "SIGN_VERIFY",
      KeySpec: "RSA_2048",
      SigningAlgorithms: ["RSASSA_PSS_SHA_256"],
      KeyId: "arn:aws:kms:ca-central-1:123456789012:key/test",
    })
    .mockResolvedValueOnce({
      Signature: signature,
      $metadata: { requestId: "mock-kms-request" },
    });
  const signed = await signWithKms(capsule, "key/test", {
    send,
  } as unknown as KMSClient);
  expect(send.mock.calls[1][0].input).toMatchObject({
    MessageType: "DIGEST",
    SigningAlgorithm: "RSASSA_PSS_SHA_256",
  });
  expect(Buffer.from(send.mock.calls[1][0].input.Message).toString("hex")).toBe(
    capsule.contentHash,
  );
  expect(verifyCapsule(signed).signature).toBe("VALID");
  const put = vi
    .fn()
    .mockResolvedValue({ $metadata: { requestId: "mock-s3-request" } });
  await storeCapsule(signed, "test-bucket", {
    send: put,
  } as unknown as S3Client);
  expect(put.mock.calls[0][0].input).toMatchObject({
    IfNoneMatch: "*",
    ServerSideEncryption: "AES256",
  });
  expect(put.mock.calls[0][0].input.Key).toMatch(
    /^capsules\/[a-f0-9]{64}\.forgecap$/,
  );
}, 30000);
