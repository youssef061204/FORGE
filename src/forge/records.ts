import { z } from "zod";
import { capabilitySchema, type Capability } from "./spec";
import { worldSchema } from "./world";
import { liveStateSchema } from "./live-contracts";
import { citySchema, cityContestSchema } from "./city-contracts";
import { labStateSchema } from "./lab-contracts";
import { productStateSchema } from "./product/contracts";

export const checkSchema = z.object({
  name: z.string(),
  category: z.enum(["test", "security"]),
  passed: z.boolean(),
  details: z.string(),
  durationMs: z.number(),
  evidence: z
    .object({
      untrustedContent: z.string(),
      nodeId: z.string(),
      attemptedOperation: z.string(),
      status: z.literal("denied"),
      error: z.string(),
      permissionDenials: z.number(),
    })
    .optional(),
});
export type Check = z.infer<typeof checkSchema>;
export const reportSchema = z.object({
  digest: z.string(),
  completedAt: z.string(),
  checks: z.array(checkSchema),
  passed: z.boolean(),
});
export type ValidationReport = z.infer<typeof reportSchema>;
export const buildProgressSchema = z.object({
  id: z.string(),
  status: z.enum(["building", "ready", "blocked", "failed"]),
  stages: z.array(
    z.object({
      name: z.string(),
      startedAt: z.string(),
      durationMs: z.number().optional(),
    }),
  ),
});
export type BuildProgress = z.infer<typeof buildProgressSchema>;
export const releaseSchema = z.object({
  definition: capabilitySchema,
  digest: z.string(),
  status: z.enum(["review", "installed", "superseded", "blocked", "rejected"]),
  resolution: z.enum(["EXACT_MATCH", "COMPOSE", "EXTEND", "SYNTHESIZE"]),
  report: reportSchema,
  artifacts: z.object({ program: z.string(), tests: z.array(z.string()) }),
  reuse: z
    .object({
      primitiveCount: z.number(),
      reusedNodes: z.array(z.string()),
      reusedCapabilities: z.array(z.string()),
      newNodes: z.number(),
    })
    .optional(),
  diff: z.object({
    addedNodes: z.array(z.string()),
    removedNodes: z.array(z.string()),
    addedPermissions: z.array(z.string()),
    removedPermissions: z.array(z.string()),
  }),
  approvedAt: z.string().optional(),
  installedAt: z.string().optional(),
  rejectedAt: z.string().optional(),
  buildStages: buildProgressSchema.shape.stages.optional(),
  approvalDecisionMs: z.number().optional(),
  approvalWaitMs: z.number().optional(),
  usage: z.object({
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    estimatedCost: z.number().nullable(),
    requestIds: z.array(z.string()).optional(),
  }),
  futures: z
    .object({
      contestId: z.string(),
      snapshotHash: z.string(),
      sourceHash: z.string(),
      rolloutCount: z.number().int().min(20).max(40),
      passed: z.literal(true),
    })
    .optional(),
});
export type Release = z.infer<typeof releaseSchema>;
export const traceSchema = z.object({
  nodeId: z.string(),
  operation: z.string(),
  status: z.enum(["success", "failed", "skipped", "denied"]),
  latencyMs: z.number(),
  attempts: z.number(),
  permission: z.string().optional(),
  error: z.string().optional(),
  inputRefs: z.array(z.string()),
  outputRef: z.string(),
});
export type TraceStep = z.infer<typeof traceSchema>;
export const executionSchema = z.object({
  id: z.string(),
  capabilityId: z.string(),
  version: z.string(),
  eventId: z.string(),
  trigger: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  latencyMs: z.number(),
  status: z.enum(["success", "failed", "ignored"]),
  trace: z.array(traceSchema),
  outcome: z.record(z.string(), z.unknown()),
  error: z.string().optional(),
  permissionDenials: z.number(),
  toolCalls: z.number(),
  model: z.string(),
  tokens: z.number(),
  estimatedCost: z.number(),
  sandbox: z.string(),
  events: z
    .array(z.object({ at: z.string(), event: z.string(), details: z.string() }))
    .optional(),
});
export type Execution = z.infer<typeof executionSchema>;
export const stateSchema = z.object({
  product: productStateSchema.optional(),
  releases: z.array(releaseSchema),
  executions: z.array(executionSchema),
  effects: z.record(
    z.string(),
    z.object({
      kind: z.enum(["document", "notification", "world"]),
      content: z.string(),
      createdAt: z.string(),
      capabilityId: z.string(),
      eventId: z.string(),
    }),
  ),
  audit: z.array(
    z.object({
      at: z.string(),
      action: z.string(),
      capabilityId: z.string(),
      details: z.string(),
    }),
  ),
  evaluation: z.unknown().optional(),
  world: worldSchema.optional(),
  live: liveStateSchema.optional(),
  city: citySchema.optional(),
  mapBackup: z.object({ snapshot: citySchema, hash: z.string() }).optional(),
  forecastVariant: z.enum(["base", "queue-adapted-2"]).optional(),
  modelEvents: z
    .array(
      z.object({
        at: z.string(),
        action: z.enum(["PROMOTED_LIVE", "ROLLBACK"]),
        version: z.string(),
        modelHash: z.string(),
      }),
    )
    .max(40)
    .optional(),
  contests: z.array(cityContestSchema).max(8).optional(),
  lab: labStateSchema.optional(),
});
export type State = z.infer<typeof stateSchema>;
export const emptyState = (): State => ({
  releases: [],
  executions: [],
  effects: {},
  audit: [],
});
export function semanticDiff(
  previous: Capability | undefined,
  next: Capability,
): Release["diff"] {
  return {
    addedNodes: next.nodes
      .filter((n) => !previous?.nodes.some((p) => p.id === n.id))
      .map((n) => n.label),
    removedNodes:
      previous?.nodes
        .filter((n) => !next.nodes.some((p) => p.id === n.id))
        .map((n) => n.label) ?? [],
    addedPermissions: next.permissions.filter(
      (p) => !previous?.permissions.includes(p),
    ),
    removedPermissions:
      previous?.permissions.filter((p) => !next.permissions.includes(p)) ?? [],
  };
}
