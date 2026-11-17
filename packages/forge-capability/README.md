# forgecap/v1

Software is portable. Trust is not.

This MIT-licensed entry point exposes a versioned signed capability format without starting FORGE's UI or a connector. It remains part of this repository and depends on its ForgeSpec validator and Zod; it has not been published as an independent npm package.

```bash
npm run capsule:verify -- path/to/Deadline-Guardian.forgecap
# With no argument, regenerate the formal JSON schema:
npm run capsule:verify
```

Import `verifyCapsule`, `serializeCapsule`, `canonicalJson`, `portableHash` and the Zod schemas from `packages/forge-capability/index.ts`. The formal [JSON schema](schema.json) is generated from the same runtime validator.

## Envelope

The extension is `.forgecap`; media type is `application/vnd.forge.capability+json`. The JSON envelope contains `payload`, `contentHash`, and `signature`.

Payload fields:

| Field        | Purpose                                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| format       | Exact `forgecap/v1` version                                                           |
| manifest     | ID, name, semantic version, timestamp, requested permissions, optional parent version |
| spec         | Portable ForgeSpec; personal request prose is replaced                                |
| artifact     | Language, real source/DSL program, content hash                                       |
| schemas      | Strict module or MCP input/output contracts                                           |
| tests        | Compatible deterministic test manifest                                                |
| evidence     | Functional/security passing and total counts; non-portable-trust policy               |
| provenance   | Provider, original artifact digest, stable evidence timestamp                         |
| dependencies | Interface/version requirements                                                        |

The package never contains connector grants, OAuth tokens, signatures' private keys, email/Calendar histories, replay datasets or owner approval. An original digest is provenance, not authorization. Source privacy still requires review: pattern rejection catches recognizable addresses/tokens/keys, not all possible embedded secrets.

## Canonical hashing and signing

`canonicalJson` recursively orders object keys by JavaScript string ordinal comparison, preserves array order and string values, omits undefined object properties, and emits compact JSON with no whitespace. Allowed input is the JSON values accepted by the strict schema. `portableHash(x)` is lowercase hexadecimal SHA-256 of UTF-8 `canonicalJson(x)`. Artifact hash is `portableHash(source)` (the canonical JSON string representation of source), and envelope `contentHash` is `portableHash(payload)`. Pretty printing is presentation only. The existing internal release digest remains its original implementation for backward compatibility.

Local development signatures use Ed25519 over the 32 decoded bytes of `contentHash`. Identical payload/key combinations package deterministically. Keys are stored in the encrypted server vault; the included public key allows offline verification.

Optional AWS KMS signatures use RSA_2048 SIGN_VERIFY, `RSASSA_PSS_SHA_256`, and `MessageType=DIGEST` over those decoded SHA-256 bytes. The capsule includes the public key, key ARN and real request ID. Offline verification hashes the canonical payload bytes with SHA-256 and verifies RSA-PSS using a 32-byte salt. RSA-PSS signatures can vary even when payload and hash are identical; deterministic content construction does not imply identical randomized signatures.

The verifier checks size (64KB), strict structure, ForgeSpec/DAG/minimum permissions, source and payload hashes, manifest/artifact consistency and the cryptographic signature. Changing source or metadata without recomputing hashes/signature fails. A valid self-contained public-key signature proves integrity relative to that key; it does not establish a trusted publisher. The UI says publisher trust NOT ESTABLISHED. Unsigned packages are not accepted in v1.

## Import policy

Valid imports are retested by the local engine and staged for review, never automatically installed. Their current state is UNTRUSTED and their grants, connector binding, replay and approval are reset. A collision gets a distinct local import ID and newly derived MCP contract. Executable imports require that installation's replay, owner approval, Google binding/consent and exact promotion before acting.

The safe tamper demonstration changes an in-memory copy of exported source and submits it to the same verifier. The exported file is preserved. This is a local gallery and portable format, not a hosted marketplace or software trust certification.
