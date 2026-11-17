import { createPublicKey } from "node:crypto";
import {
  KMSClient,
  GetPublicKeyCommand,
  SignCommand,
} from "@aws-sdk/client-kms";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { assertPaidActionAllowed } from "./cost-policy";
import {
  type Capsule,
  portableHash,
  serializeCapsule,
  verifyCapsule,
} from "./capsule";
const config = () => ({
  region: process.env.AWS_REGION ?? "ca-central-1",
  profile: process.env.AWS_PROFILE ?? "forge",
  maxAttempts: 1,
});
export async function signWithKms(
  capsule: Capsule,
  keyId: string,
  client?: KMSClient,
): Promise<Capsule> {
  assertPaidActionAllowed("AWS KMS capsule signing");
  const activeClient = client ?? new KMSClient(config());
  const region = config().region;
  const publicKey = await activeClient.send(
    new GetPublicKeyCommand({ KeyId: keyId }),
    { abortSignal: AbortSignal.timeout(10000) },
  );
  if (
    !publicKey.PublicKey ||
    publicKey.KeyUsage !== "SIGN_VERIFY" ||
    publicKey.KeySpec !== "RSA_2048" ||
    !publicKey.SigningAlgorithms?.includes("RSASSA_PSS_SHA_256") ||
    !publicKey.KeyId?.startsWith("arn:aws:kms:" + region + ":")
  )
    throw new Error("KMS requires a regional RSA_2048 SIGN_VERIFY key");
  assertPaidActionAllowed("AWS KMS capsule signing");
  const result = await activeClient.send(
    new SignCommand({
      KeyId: publicKey.KeyId,
      Message: Buffer.from(capsule.contentHash, "hex"),
      MessageType: "DIGEST",
      SigningAlgorithm: "RSASSA_PSS_SHA_256",
    }),
    { abortSignal: AbortSignal.timeout(10000) },
  );
  if (!result.Signature || !result.$metadata.requestId)
    throw new Error("KMS did not return verifiable signing evidence");
  const signed: Capsule = {
    ...capsule,
    signature: {
      algorithm: "RSASSA_PSS_SHA_256",
      provider: "AWS KMS",
      publicKey: createPublicKey({
        key: Buffer.from(publicKey.PublicKey),
        format: "der",
        type: "spki",
      })
        .export({ format: "pem", type: "spki" })
        .toString(),
      value: Buffer.from(result.Signature).toString("base64"),
      keyArn: publicKey.KeyId,
      requestId: result.$metadata.requestId,
    },
  };
  verifyCapsule(signed);
  return signed;
}
export async function storeCapsule(
  capsule: Capsule,
  bucket: string,
  client?: S3Client,
) {
  assertPaidActionAllowed("Amazon S3 capsule storage");
  const activeClient = client ?? new S3Client(config());
  verifyCapsule(capsule);
  const key = "capsules/" + portableHash(capsule) + ".forgecap";
  const result = await activeClient.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: serializeCapsule(capsule),
      ContentType: "application/vnd.forge.capability+json",
      ServerSideEncryption: "AES256",
      IfNoneMatch: "*",
    }),
    { abortSignal: AbortSignal.timeout(10000) },
  );
  return { key, requestId: result.$metadata.requestId };
}
