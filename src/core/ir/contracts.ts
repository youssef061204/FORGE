/** The forge-ir/v1 program interface: what a program sees and may propose. */
import { z } from "zod";
export type { JsonSchema } from "../contracts/json-schema";
import type { JsonSchema } from "../contracts/json-schema";

z.config({ jitless: true });

const jsonObject = z.record(z.string(), z.unknown());
const operationId = z.string().regex(/^[a-z][a-z0-9_-]{0,47}\.[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/);

export const programInputSchema = z
  .object({
    now: z.string().datetime(),
    input: jsonObject,
    observations: jsonObject,
    state: jsonObject,
  })
  .strict();
export const programOutputSchema = z
  .object({
    operations: z.array(z.object({ operation: operationId, arguments: jsonObject }).strict()).max(20),
    result: z
      .object({
        summary: z.string().min(1).max(300),
        details: z.array(z.string().max(300)).max(12).default([]),
      })
      .strict(),
    state: jsonObject.default({}),
  })
  .strict();
export type ProgramInput = z.infer<typeof programInputSchema>;
export type ProgramOutput = z.infer<typeof programOutputSchema>;

export type OperationDescriptor = {
  id: string;
  connector: string;
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permission: string;
  kind: "read" | "write";
  sideEffect: "none" | "reversible" | "irreversible";
  idempotent: boolean;
};
export type ReadDeclaration = { ref: string; operation: string; arguments: Record<string, unknown> };
/** Kept for the type checker's historical signature. */
export type ProgramDraft = { reads: ReadDeclaration[] };
