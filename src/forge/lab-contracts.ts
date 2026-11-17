import { z } from "zod";
import {
  citySchema,
  rolloutSchema,
  simulationControlSchema,
} from "./city-contracts";
export const labReportSchema = z.object({
  id: z.string(),
  kind: z.enum(["what-if", "chaos", "ablation"]),
  at: z.string(),
  status: z.enum(["running", "complete", "failed"]),
  sourceDigest: z.string(),
  snapshotHash: z.string(),
  currentWorldChanged: z.literal(false),
  error: z.string().optional(),
  rows: z
    .array(
      z.object({
        scenario: z.string(),
        seed: z.number(),
        baseline: rolloutSchema,
        treatment: rolloutSchema,
        lossDelta: z.number(),
      }),
    )
    .max(20),
});
export type LabReport = z.infer<typeof labReportSchema>;
export const labStateSchema = z.object({
  missions: z
    .array(
      z.object({
        at: z.string(),
        request: z.string().max(4000),
        contestId: z.string(),
        followUp: z.boolean(),
      }),
    )
    .max(12),
  checkpoints: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().max(60),
        at: z.string(),
        hash: z.string(),
        snapshot: citySchema,
      }),
    )
    .max(3),
  reports: z.array(labReportSchema).max(5),
  challenge: z
    .object({
      contestId: z.string(),
      digest: z.string(),
      binding: z.string(),
      codeHash: z.string(),
      expiresAt: z.number(),
    })
    .optional(),
});
export const labCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("checkpoint"),
      name: z.string().min(1).max(60),
    })
    .strict(),
  z.object({ action: z.literal("restore"), id: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal("arm"),
      contestId: z.string().uuid(),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({ action: z.literal("confirm"), code: z.string().regex(/^\d{6}$/) })
    .strict(),
  z
    .object({
      action: z.literal("experiment"),
      digest: z.string().length(64),
      kind: z.enum(["what-if", "chaos", "ablation"]),
      change: simulationControlSchema.optional(),
      operation: z.string().max(40).optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("passport"), contestId: z.string().uuid() })
    .strict(),
  z.object({ action: z.literal("briefing") }).strict(),
]);
