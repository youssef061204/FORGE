import { z } from "zod";
import type { Capability } from "./spec";

export function toolInputSchema(trigger: Capability["trigger"]) {
  return trigger === "new_job_posting"
    ? z
        .object({
          eventId: z.string().min(1).max(100),
          jobPosting: z.record(z.string(), z.unknown()),
        })
        .strict()
    : z
        .object({
          eventId: z.string().min(1).max(100),
          text: z.string().min(1).max(10000),
        })
        .strict();
}
export const toolOutputSchema = z
  .object({
    id: z.string(),
    capabilityId: z.string(),
    version: z.string(),
    eventId: z.string(),
    status: z.enum(["success", "failed", "ignored"]),
    trace: z.array(z.record(z.string(), z.unknown())),
    outcome: z.record(z.string(), z.unknown()),
  })
  .passthrough();
export function deriveToolContract(id: string, trigger: Capability["trigger"]) {
  return {
    name: id.replaceAll("-", "_"),
    inputSchema: z.toJSONSchema(toolInputSchema(trigger)),
    outputSchema: z.toJSONSchema(toolOutputSchema),
  };
}
