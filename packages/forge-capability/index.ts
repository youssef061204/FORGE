// MIT. This entry point exposes the format without starting a UI, service or connector.
export {
  capsuleSchema,
  capsulePayloadSchema,
  verifyCapsule,
  serializeCapsule,
  canonicalJson,
  portableHash,
  packageCapsule,
} from "../../src/forge/capsule";
export type { Capsule } from "../../src/forge/capsule";
