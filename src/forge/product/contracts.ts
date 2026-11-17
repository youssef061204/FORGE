import { z } from "zod";

export type JsonSchema = Record<string, unknown>;
export const jsonObject = z.record(z.string(), z.unknown());
export const operationId = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,47}\.[a-zA-Z][a-zA-Z0-9_.-]{0,95}$/);
export const invocationSchema = z
  .object({ operation: operationId, arguments: jsonObject })
  .strict();
export type Invocation = z.infer<typeof invocationSchema>;
export const readSchema = invocationSchema.extend({
  ref: z.string().regex(/^[a-z][a-zA-Z0-9_]{0,31}$/),
});
export const triggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }).strict(),
  z
    .object({
      kind: z.enum([
        "schedule",
        "poll",
        "new_email",
        "calendar_change",
        "condition",
      ]),
      intervalSeconds: z.number().int().min(60).max(604800),
      condition: z.string().max(300).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("connector_event"),
      connector: z.string().min(1).max(48),
      event: z.string().min(1).max(100),
    })
    .strict(),
]);
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
    operations: z.array(invocationSchema).max(20),
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
export const postconditionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("effect"),
      operation: operationId,
      arguments: jsonObject.optional(),
      count: z.number().int().min(0).max(20),
    })
    .strict(),
  z
    .object({
      kind: z.literal("artifact"),
      name: z.string().min(1).max(80),
      format: z.enum(["csv", "text", "json"]),
      schema: jsonObject.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("readback"),
      operation: operationId,
      arguments: jsonObject,
      schema: jsonObject,
    })
    .strict(),
]);
export type Postcondition = z.infer<typeof postconditionSchema>;
export const programDraftSchema = z
  .object({
    name: z.string().min(2).max(80),
    description: z.string().min(5).max(500),
    source: z.string().min(20).max(16000),
    reads: z.array(readSchema).max(12),
    actions: z.array(operationId).max(20),
    trigger: triggerSchema,
    postconditions: z.array(postconditionSchema).max(20).optional(),
    representation: z
      .object({
        kind: z.literal("forge-ir/v1"),
        ir: jsonObject,
        compilerVersion: z.string().min(1).max(100),
      })
      .strict()
      .optional(),
    tests: z
      .array(
        z
          .object({
            name: z.string().max(100),
            input: programInputSchema,
            expectedOperations: z.array(operationId).max(20),
            expectedEffects: z.array(invocationSchema).max(20).optional(),
            expectedOutput: programOutputSchema.optional(),
          })
          .strict(),
      )
      .min(2)
      .max(12),
  })
  .strict();
export type ProgramDraft = z.infer<typeof programDraftSchema>;
export const usageSchema = z.object({
  tokensComplete: z.boolean().optional(),
  stageTimings: z.record(z.string(), z.number().nonnegative()).optional(),
  provider: z.string(),
  model: z.string().nullable(),
  region: z.string().nullable(),
  requestId: z.string().optional(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  durationMs: z.number(),
  schemaValidated: z.boolean(),
  calls: z.number(),
});
export const programSchema = programDraftSchema.extend({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  parentHash: z.string().optional(),
  provenance: z
    .array(
      z
        .object({
          id: z.string(),
          version: z.string(),
          hash: z.string().length(64),
        })
        .strict(),
    )
    .max(4)
    .default([]),
  hash: z.string(),
  goal: z.string().min(5).max(4000),
  connectors: z.array(z.string()),
  permissions: z.array(z.string()),
  bindings: z.record(z.string(), z.string()),
  status: z.enum([
    "review",
    "ready",
    "running",
    "paused",
    "revoked",
    "superseded",
    "rejected",
    "blocked",
  ]),
  createdAt: z.string().datetime(),
  installedAt: z.string().datetime().optional(),
  lastRunAt: z.string().datetime().optional(),
  nextRunAt: z.string().datetime().optional(),
  grants: z.array(z.string()).default([]),
  programState: jsonObject.default({}),
  usage: usageSchema,
  evidence: z.object({
    checks: z.array(
      z.object({ name: z.string(), passed: z.boolean(), details: z.string() }),
    ),
    passed: z.boolean(),
    replay: z.object({
      source: z.enum([
        "authorized_history",
        "test_connector",
        "simulation",
        "unavailable",
      ]),
      observations: z.number(),
      proposedOperations: z.number(),
      externalWrites: z.literal(0),
      summary: z.string(),
      at: z.string().datetime(),
    }),
    compileMs: z.number(),
    sandboxMs: z.number(),
    sourceHash: z.string(),
  }),
});
export type Program = z.infer<typeof programSchema>;
export const routeSchema = z.enum([
  "REUSE",
  "COMPOSE",
  "EXTEND",
  "SYNTHESIZE",
  "OPTIMIZE",
  "LEARNED_POLICY",
  "CONNECT",
  "CLARIFY",
  "UNSUPPORTED",
]);
export type SolutionRoute = z.infer<typeof routeSchema>;
export const solutionSchema = z
  .object({
    route: routeSchema,
    explanation: z.string().min(1).max(700),
    existingIds: z.array(z.string()).max(4),
    missingConnections: z.array(z.string().max(100)).max(8),
    question: z.string().max(500).optional(),
    program: programDraftSchema.optional(),
  })
  .strict();
export type Solution = z.infer<typeof solutionSchema>;
export const receiptSchema = z.object({
  connector: z.string(),
  operation: z.string(),
  target: z.string(),
  responseId: z.string().optional(),
  at: z.string().datetime(),
  status: z.enum(["committed", "deduplicated", "proposed", "failed"]),
  mode: z.enum(["live", "test", "simulation"]),
});
export type Receipt = z.infer<typeof receiptSchema>;
export const verificationCheckSchema = z
  .object({
    name: z.string().min(1).max(150),
    status: z.enum(["verified", "failed", "unverified"]),
    details: z.string().max(500),
  })
  .strict();
export const runVerificationSchema = z
  .object({
    status: z.enum(["verified", "failed", "unverified"]),
    checks: z.array(verificationCheckSchema).max(60),
    durationMs: z.number().nonnegative(),
  })
  .strict();
export type RunVerification = z.infer<typeof runVerificationSchema>;
export const runSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  version: z.string(),
  hash: z.string(),
  eventId: z.string(),
  at: z.string().datetime(),
  durationMs: z.number(),
  status: z.enum(["done", "failed", "ignored"]),
  summary: z.string(),
  details: z.array(z.string()),
  receipts: z.array(receiptSchema),
  mode: z.enum(["live", "test", "simulation"]),
  error: z.string().optional(),
  verification: runVerificationSchema.optional(),
});
export type ProgramRun = z.infer<typeof runSchema>;
export const connectionConfigSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
  name: z.string().min(2).max(80),
  kind: z.enum(["openapi", "mcp"]),
  baseUrl: z.string().url(),
  domains: z.array(z.string().min(1).max(253)).min(1).max(10),
  operationAllowlist: z.array(z.string()).min(1).max(100),
  readOperations: z.array(z.string()).max(100).default([]),
  spec: jsonObject.optional(),
  importedOperations: z.array(jsonObject).default([]),
  binding: z.string(),
  enabled: z.boolean().default(true),
});
export type ConnectionConfig = z.infer<typeof connectionConfigSchema>;
export const workspaceFormatSchema = z.enum(["csv", "text", "json"]);
const workspaceFileSchema = z.object({
  id: z.string().regex(/^[da][0-9a-f]{24}$/),
  name: z.string().min(1).max(80),
  format: workspaceFormatSchema,
  text: z.string().max(16384),
  bytes: z.number().int().min(0).max(16384),
  sha256: z.string().length(64),
  createdAt: z.string().datetime(),
});
export const workspaceSchema = z.object({
  binding: z.string().default(""),
  documents: z.array(workspaceFileSchema).max(20).default([]),
  artifacts: z
    .array(
      workspaceFileSchema.extend({
        text: z.string().max(5000),
        bytes: z.number().int().min(0).max(5000),
        effectKey: z.string().length(64),
      }),
    )
    .max(100)
    .default([]),
});
export type WorkspaceState = z.infer<typeof workspaceSchema>;
export type WorkspaceFormat = z.infer<typeof workspaceFormatSchema>;
export const emptyWorkspace = (): WorkspaceState => ({
  binding: "",
  documents: [],
  artifacts: [],
});
export const productStateSchema = z.object({
  workspace: workspaceSchema.default(emptyWorkspace),
  programs: z.array(programSchema).max(250),
  runs: z.array(runSchema).max(1000),
  connectors: z.array(connectionConfigSchema).max(20),
  executionPlans: z
    .record(
      z.string(),
      z.object({
        output: programOutputSchema,
        createdAt: z.string().datetime(),
        run: runSchema.optional(),
      }),
    )
    .default({}),
  outbox: z.record(
    z.string(),
    z.object({
      status: z.enum(["pending", "committed", "uncertain"]),
      at: z.string(),
      receipt: receiptSchema.optional(),
    }),
  ),
  triggerEvents: z.record(
    z.string(),
    z.object({
      status: z.enum(["pending", "done", "failed"]),
      at: z.string(),
      toolId: z.string(),
      hash: z.string().optional(),
      input: jsonObject.optional(),
      latencyMs: z.number().optional(),
    }),
  ),
  conversation: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "forge"]),
        text: z.string().max(4000),
        at: z.string(),
        toolId: z.string().optional(),
      }),
    )
    .max(100),
  lastToolId: z.string().optional(),
  scheduler: z.object({
    backend: z.literal("local"),
    lastTickAt: z.string().optional(),
  }),
  providerRequests: z
    .array(
      z.object({
        id: z.string(),
        at: z.string(),
        status: z.enum(["started", "succeeded", "failed"]),
        requestId: z.string().optional(),
      }),
    )
    .max(500)
    .default([]),
});
export type ProductState = z.infer<typeof productStateSchema>;
export const emptyProductState = (): ProductState => ({
  workspace: emptyWorkspace(),
  programs: [],
  runs: [],
  connectors: [],
  executionPlans: {},
  outbox: {},
  triggerEvents: {},
  conversation: [],
  scheduler: { backend: "local" },
  providerRequests: [],
});

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
export type ConnectorDescriptor = {
  id: string;
  name: string;
  kind: "builtin" | "openapi" | "mcp";
  status: "connected" | "needs_consent" | "not_configured" | "error";
  mode: "live" | "test" | "simulation";
  binding: string;
  setup: string;
  constraints: Record<string, unknown>;
  operations: OperationDescriptor[];
};
export type CallContext = {
  key: string;
  mode: "replay" | "live";
  now: string;
  observations: Record<string, unknown>;
  // Trusted transaction state only. Never passed into generated software.
  workspace?: WorkspaceState;
};
export type ConnectorResult = {
  data: unknown;
  responseId?: string;
  target?: string;
};
export type EffectVerification = {
  status: "verified" | "failed" | "unverified";
  reason: string;
  // Fresh committed-state readback; never persisted in public run evidence.
  data?: unknown;
};
export type VerificationContext = CallContext & { receipt: Receipt };
export interface FabricConnector {
  describe(): Promise<ConnectorDescriptor>;
  preflight?(
    operation: string,
    args: Record<string, unknown>,
    context: CallContext,
  ): Promise<void>;
  invoke(
    operation: string,
    args: Record<string, unknown>,
    context: CallContext,
  ): Promise<ConnectorResult>;
  verify?(
    operation: string,
    args: Record<string, unknown>,
    context: VerificationContext,
  ): Promise<EffectVerification>;
}
