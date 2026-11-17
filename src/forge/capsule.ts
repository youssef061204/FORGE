import {
  generateKeyPairSync,
  createPublicKey,
  sign,
  verify,
  createHash,
  constants,
} from "node:crypto";
import { z } from "zod";
import { capabilitySchema, validateCapability } from "./spec";
import { digest } from "./hash";
import { moduleInputSchema, moduleOutputSchema } from "./live-contracts";
import { cityInputSchema, cityOutputSchema } from "./city-contracts";
import { SecretVault } from "./vault";
import type { Release } from "./records";

export const capsulePayloadSchema = z
  .object({
    format: z.literal("forgecap/v1"),
    manifest: z
      .object({
        id: z.string().max(64),
        name: z.string().max(100),
        version: z.string().max(40),
        createdAt: z.iso.datetime(),
        permissions: z.array(z.string().max(100)).max(14),
        parentVersion: z.string().max(40).optional(),
      })
      .strict(),
    spec: capabilitySchema,
    artifact: z
      .object({
        language: z.enum(["typescript", "ForgeSpec/1"]),
        source: z.string().max(32000),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    schemas: z
      .object({
        input: z.record(z.string(), z.unknown()),
        output: z.record(z.string(), z.unknown()),
      })
      .strict(),
    tests: z.array(z.string().max(100)).max(40),
    evidence: z
      .object({
        functionalPassed: z.number().int(),
        functionalTotal: z.number().int(),
        securityPassed: z.number().int(),
        securityTotal: z.number().int(),
        policy: z.literal(
          "Evidence is portable; local trust and connector grants are not",
        ),
      })
      .strict(),
    provenance: z
      .object({
        provider: z.string().max(200),
        originalDigest: z.string().regex(/^[a-f0-9]{64}$/),
        exportedAt: z.iso.datetime(),
      })
      .strict(),
    dependencies: z
      .array(
        z
          .object({
            interface: z.string().max(100),
            version: z.string().max(40),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
const localSignature = z
  .object({
    algorithm: z.literal("Ed25519"),
    provider: z.literal("LOCAL DEVELOPMENT"),
    publicKey: z.string().max(500),
    value: z.string().max(200),
  })
  .strict();
const kmsSignature = z
  .object({
    algorithm: z.literal("RSASSA_PSS_SHA_256"),
    provider: z.literal("AWS KMS"),
    publicKey: z.string().max(2000),
    value: z.string().max(1000),
    keyArn: z.string().max(300),
    requestId: z.string().max(100),
  })
  .strict();
export const capsuleSchema = z
  .object({
    payload: capsulePayloadSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    signature: z.discriminatedUnion("provider", [localSignature, kmsSignature]),
  })
  .strict();
export type Capsule = z.infer<typeof capsuleSchema>;
export async function signingKey(vault = new SecretVault()) {
  const existing = await vault.get("capsule-key");
  if (existing)
    return z
      .object({ privateKey: z.string(), publicKey: z.string() })
      .parse(existing);
  const keys = generateKeyPairSync("ed25519");
  const result = {
    privateKey: keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    publicKey: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  };
  await vault.set("capsule-key", result);
  return result;
}
export function packageCapsule(
  release: Release,
  key: { privateKey: string; publicKey: string },
): Capsule {
  if (!release.report.passed || digest(release.definition) !== release.digest)
    throw new Error("Only intact passing artifacts can be packaged");
  // Request prose is personal and unnecessary to run a capability. Keep it out of the portable artifact.
  const spec = structuredClone(release.definition);
  spec.intent = "Portable capability; local replay and owner approval required";
  spec.description = "Portable permission-scoped capability";
  spec.reason = "Imported software requires independent local admission";
  if (spec.goal) {
    spec.goal.goal = "Portable measurable environment policy";
    spec.goal.interpretation =
      "Portable objectives and hard constraints; fresh local Futures and owner approval required";
    spec.goal.priorities = spec.goal.objectives.map((o) => o.metric);
    spec.goal.forbiddenOutcomes = [
      "Host safety gates and measurable hard constraints apply",
    ];
  }
  const source = spec.executable?.source ?? JSON.stringify(spec);
  if (
    /-----BEGIN .*PRIVATE KEY|ya29\.|Bearer\s+[a-z0-9]|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(
      source,
    )
  )
    throw new Error(
      "Portable source may contain private data or secrets; export rejected",
    );
  const tests = release.report.checks.filter((c) => c.category === "test");
  const security = release.report.checks.filter(
    (c) => c.category === "security",
  );
  const payload = capsulePayloadSchema.parse({
    format: "forgecap/v1",
    manifest: {
      id: spec.id,
      name: spec.name,
      version: spec.version,
      createdAt: spec.createdAt,
      permissions: spec.permissions,
      ...(spec.parentVersion ? { parentVersion: spec.parentVersion } : {}),
    },
    spec,
    artifact: {
      language: spec.executable ? "typescript" : "ForgeSpec/1",
      source,
      hash: digest(source),
    },
    schemas: spec.executable
      ? {
          input: z.toJSONSchema(
            spec.executable.interface === "city/v1"
              ? cityInputSchema
              : moduleInputSchema,
          ),
          output: z.toJSONSchema(
            spec.executable.interface === "city/v1"
              ? cityOutputSchema
              : moduleOutputSchema,
          ),
        }
      : {
          input: spec.toolContract.inputSchema,
          output: spec.toolContract.outputSchema,
        },
    tests: release.report.checks.map((c) => c.name),
    evidence: {
      functionalPassed: tests.filter((c) => c.passed).length,
      functionalTotal: tests.length,
      securityPassed: security.filter((c) => c.passed).length,
      securityTotal: security.length,
      policy: "Evidence is portable; local trust and connector grants are not",
    },
    provenance: {
      provider: release.usage.model,
      originalDigest: release.digest,
      exportedAt: release.report.completedAt,
    },
    dependencies: [
      { interface: spec.executable?.interface ?? "ForgeSpec/1", version: "1" },
    ],
  });
  payload.artifact.hash = portableHash(source);
  const contentHash = portableHash(payload);
  return {
    payload,
    contentHash,
    signature: {
      algorithm: "Ed25519",
      provider: "LOCAL DEVELOPMENT",
      publicKey: key.publicKey,
      value: sign(
        null,
        Buffer.from(contentHash, "hex"),
        key.privateKey,
      ).toString("base64"),
    },
  };
}
export function verifyCapsule(raw: unknown) {
  if (Buffer.byteLength(JSON.stringify(raw)) > 65536)
    throw new Error("Capsule size budget exceeded");
  const capsule = capsuleSchema.parse(raw);
  if (
    portableHash(capsule.payload) !== capsule.contentHash ||
    portableHash(capsule.payload.artifact.source) !==
      capsule.payload.artifact.hash
  )
    throw new Error("Capsule content hash mismatch: tampered artifact");
  const cap = validateCapability(capsule.payload.spec);
  const artifactMatches = cap.executable
    ? capsule.payload.artifact.source === cap.executable.source
    : digest(JSON.parse(capsule.payload.artifact.source)) === digest(cap);
  if (
    digest(capsule.payload.manifest.permissions) !== digest(cap.permissions) ||
    capsule.payload.manifest.id !== cap.id ||
    capsule.payload.manifest.version !== cap.version ||
    capsule.payload.manifest.name !== cap.name ||
    !artifactMatches
  )
    throw new Error("Capsule manifest/artifact contract mismatch");
  const key = createPublicKey(capsule.signature.publicKey);
  const valid =
    capsule.signature.provider === "LOCAL DEVELOPMENT"
      ? key.asymmetricKeyType === "ed25519" &&
        verify(
          null,
          Buffer.from(capsule.contentHash, "hex"),
          key,
          Buffer.from(capsule.signature.value, "base64"),
        )
      : key.asymmetricKeyType === "rsa" &&
        verify(
          "sha256",
          Buffer.from(canonicalJson(capsule.payload)),
          { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
          Buffer.from(capsule.signature.value, "base64"),
        );
  if (!valid) throw new Error("Capsule signature invalid");
  return {
    capsule,
    signature: "VALID" as const,
    publisherTrust: "NOT ESTABLISHED" as const,
    fingerprint: digest(capsule.signature.publicKey),
  };
}
export function serializeCapsule(capsule: Capsule) {
  return JSON.stringify(JSON.parse(canonicalJson(capsule)), null, 2) + "\n";
}
export function canonicalJson(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return JSON.stringify(canonical(value));
}
export function portableHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
