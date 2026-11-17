/**
 * Fail closed before constructing cloud clients, resolving credentials, or
 * sending requests. A provider's free tier or existing credits are not proof
 * that a particular operation is free.
 *
 * Adapters remain available for a future, separately authorized deployment.
 * The submission and all normal launches default to free-only operation.
 */
export function freeOnlyEnabled(
  environment: Record<string, string | undefined> = process.env,
) {
  return environment.FORGE_FREE_ONLY !== "false";
}

export class FreeOnlyViolation extends Error {
  readonly code = "FORGE_FREE_ONLY";
  constructor(readonly feature: string) {
    super(
      `${feature} is disabled by FORGE's free-only policy. No cloud request or credential lookup was made.`,
    );
    this.name = "FreeOnlyViolation";
  }
}

export function assertPaidActionAllowed(feature: string) {
  if (freeOnlyEnabled()) throw new FreeOnlyViolation(feature);
}
