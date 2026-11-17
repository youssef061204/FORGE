import { z } from "zod";
import { digest } from "../hash";
import { ConnectorFabric } from "./fabric";
import {
  readSchema,
  triggerSchema,
  postconditionSchema,
  type ConnectorDescriptor,
  type OperationDescriptor,
} from "./contracts";
import type { PlanningContext } from "./provider";

export const missionPlanSchema = z
  .object({
    version: z.literal("mission-plan/v1"),
    route: z.enum([
      "REUSE",
      "COMPOSE",
      "EXTEND",
      "SYNTHESIZE",
      "CONNECT",
      "CLARIFY",
      "UNSUPPORTED",
      "OPTIMIZE",
    ]),
    objective: z.string().min(1).max(700),
    explanation: z.string().min(1).max(700),
    requirements: z
      .array(
        z
          .object({
            id: z.string().min(1).max(40),
            description: z.string().min(1).max(300),
            access: z.enum(["read", "write", "compute"]),
            connector: z.string().max(100).nullable(),
            operation: z.string().max(150).nullable(),
            status: z.enum([
              "available",
              "missing",
              "uncertain",
              "unsupported",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    questions: z.array(z.string().min(1).max(400)).max(5),
    existingIds: z.array(z.string()).max(4),
    constraints: z.array(z.string().max(300)).max(12),
    program: z
      .object({
        name: z.string().min(2).max(80),
        description: z.string().min(5).max(500),
        reads: z.array(readSchema).max(12),
        actions: z.array(z.string()).max(20),
        permissions: z.array(z.string()).max(32).optional(),
        trigger: triggerSchema,
        representation: z.enum(["ir", "typescript"]),
        customComputationReason: z.string().max(300).optional(),
        outputs: z
          .array(
            z
              .object({
                name: z.string().min(1).max(80),
                format: z.enum(["json", "csv", "text"]),
                shape: z
                  .enum([
                    "object",
                    "array",
                    "string",
                    "number",
                    "boolean",
                    "null",
                  ])
                  .optional(),
                schema: z.record(z.string(), z.unknown()).optional(),
              })
              .strict(),
          )
          .max(12),
        postconditions: z.array(postconditionSchema).max(12).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();
export type MissionPlan = z.infer<typeof missionPlanSchema>;

export type PlanningDiagnostic = {
  stage:
    | "intent"
    | "grounding"
    | "plan"
    | "generation"
    | "compilation"
    | "verification";
  code: string;
  message: string;
  path?: string;
  retryable: boolean;
};
export class PlanningError extends Error {
  constructor(readonly diagnostic: PlanningDiagnostic) {
    super(diagnostic.message);
    this.name = "PlanningError";
  }
}
function invalid(code: string, message: string, path?: string): never {
  throw new PlanningError({
    stage: "grounding",
    code,
    message,
    path,
    retryable: true,
  });
}

// The graph is derived from resource contracts, never from a task vocabulary.
export function resourceCatalog(resources: ConnectorDescriptor[]) {
  const connectors = new Map(
    resources.map((resource) => [resource.id, resource]),
  );
  const operations = new Map<string, OperationDescriptor>();
  const edges: { from: string; relation: string; to: string }[] = [];
  for (const resource of resources) {
    for (const operation of resource.operations) {
      if (operation.connector !== resource.id || operations.has(operation.id))
        invalid(
          "CATALOG_IDENTITY",
          "Resource discovery returned conflicting operation identities",
        );
      operations.set(operation.id, operation);
      edges.push(
        { from: resource.id, relation: "exposes", to: operation.id },
        { from: operation.id, relation: "requires", to: operation.permission },
        {
          from: operation.id,
          relation: "consumes",
          to: digest(operation.inputSchema),
        },
        {
          from: operation.id,
          relation: "produces",
          to: digest(operation.outputSchema),
        },
      );
    }
  }
  return { connectors, operations, edges, fingerprint: digest(resources) };
}

export async function groundPlan(raw: unknown, context: PlanningContext) {
  const plan = missionPlanSchema.parse(raw);
  const catalog = resourceCatalog(context.resources);
  const missing: string[] = [];
  const boundedResources: string[] = [];
  for (const requirement of plan.requirements) {
    if (requirement.access === "compute") {
      if (requirement.operation || requirement.connector)
        invalid(
          "COMPUTE_AUTHORITY",
          "A pure computation requirement cannot confer connector authority",
          requirement.id,
        );
      continue;
    }
    const operation = requirement.operation
      ? catalog.operations.get(requirement.operation)
      : undefined;
    const connector = requirement.connector
      ? catalog.connectors.get(requirement.connector)
      : undefined;
    if (connector?.constraints.unavailableToCompiler && !operation) {
      boundedResources.push(connector.name);
      continue;
    }
    if (
      requirement.status === "missing" &&
      connector?.status === "connected" &&
      operation?.connector === connector.id &&
      operation.kind === requirement.access
    )
      invalid(
        "REQUIREMENT_STATUS_CONTRADICTION",
        "The required operation is already connected; request clarification or correct the plan rather than asking to connect it again",
        requirement.id,
      );
    if (
      requirement.status === "missing" ||
      !connector ||
      connector.status !== "connected" ||
      !operation
    ) {
      missing.push(requirement.connector ?? requirement.description);
      continue;
    }
    if (
      operation.connector !== connector.id ||
      operation.kind !== requirement.access
    )
      invalid(
        "REQUIREMENT_MISMATCH",
        "A required effect does not match its declared resource operation",
        requirement.id,
      );
  }
  const uncertain = plan.requirements.filter(
    (requirement) => requirement.status === "uncertain",
  );
  if (boundedResources.length)
    return {
      plan: {
        ...plan,
        route: "UNSUPPORTED" as const,
        explanation:
          "The connected resource exceeds this compiler's bounded context: " +
          boundedResources.join(", ") +
          ". Its specialized inspector remains available.",
        program: undefined,
      },
      missingConnections: [],
      metadata: undefined,
    };
  if (
    plan.requirements.some(
      (requirement) => requirement.status === "unsupported",
    ) ||
    plan.route === "UNSUPPORTED"
  ) {
    return {
      plan: { ...plan, route: "UNSUPPORTED" as const, program: undefined },
      missingConnections: [],
      metadata: undefined,
    };
  }
  if (uncertain.length || plan.questions.length || plan.route === "CLARIFY") {
    if (!plan.questions.length)
      invalid(
        "QUESTION_MISSING",
        "Clarification must name the specific unresolved user choice",
      );
    return {
      plan: { ...plan, route: "CLARIFY" as const, program: undefined },
      missingConnections: [],
      metadata: undefined,
    };
  }
  if (missing.length || plan.route === "CONNECT") {
    if (!missing.length)
      invalid(
        "MISSING_WITNESS",
        "A connection request must identify an unavailable required resource",
      );
    return {
      plan: { ...plan, route: "CONNECT" as const, program: undefined },
      missingConnections: [...new Set(missing)],
      metadata: undefined,
    };
  }
  for (const id of plan.existingIds)
    if (!context.existing.some((program) => program.id === id))
      invalid(
        "UNKNOWN_PROGRAM",
        "The plan selected a tool absent from the retrieved installed catalog",
        id,
      );
  if (
    context.editTargetId &&
    (plan.route !== "EXTEND" ||
      plan.existingIds.length !== 1 ||
      plan.existingIds[0] !== context.editTargetId)
  )
    invalid("EDIT_TARGET", "An explicit edit must extend the selected tool");
  if (
    (plan.route === "REUSE" || plan.route === "EXTEND") &&
    plan.existingIds.length !== 1
  )
    invalid(
      "ONE_PARENT",
      "Reuse and extension require exactly one available installed tool",
    );
  if (plan.route === "COMPOSE" && new Set(plan.existingIds).size < 2)
    invalid(
      "COMPOSITION_PARENTS",
      "Composition requires at least two distinct installed tools",
    );
  if (plan.route === "SYNTHESIZE" && plan.existingIds.length)
    invalid(
      "UNDECLARED_LINEAGE",
      "A new synthesis cannot claim existing program lineage",
    );
  if (plan.route === "REUSE") {
    const target = context.existing.find(
      (program) => program.id === plan.existingIds[0],
    );
    if (target?.status && !["ready", "running"].includes(target.status))
      invalid(
        "REUSE_NOT_READY",
        "The selected program is not currently enabled for reuse",
      );
    if (plan.program)
      invalid(
        "UNNEEDED_GENERATION",
        "Reuse must not generate a replacement program",
      );
    return { plan, missingConnections: [], metadata: undefined };
  }
  if (plan.route === "OPTIMIZE")
    invalid(
      "SPECIALIZED_ENGINE_UNAVAILABLE",
      "No specialized execution engine was declared by the connected resource catalog",
    );
  if (!plan.program)
    invalid(
      "PROGRAM_MISSING",
      "The grounded plan is missing its implementation contract",
    );
  const program = plan.program;
  for (const output of program.outputs)
    if (
      (output.format === "csv" && output.shape && output.shape !== "object") ||
      (output.format === "text" && output.shape && output.shape !== "string")
    )
      invalid(
        "OUTPUT_SHAPE",
        "The output root shape contradicts its serialization format",
      );
  if (program.outputs.length && !program.actions.length)
    invalid(
      "OUTPUT_WITHOUT_EFFECT",
      "A downloadable output requires a declared storage action",
    );
  if (
    program.representation === "typescript" &&
    !program.customComputationReason?.trim()
  )
    invalid(
      "CUSTOM_REASON_MISSING",
      "Custom source requires a specific computation that the typed representation cannot express",
    );
  const selected = new Set([
    ...program.reads.map((read) => read.operation),
    ...program.actions,
  ]);
  for (const requirement of plan.requirements)
    if (requirement.operation && !selected.has(requirement.operation))
      invalid(
        "OMITTED_REQUIREMENT",
        "The implementation omitted an operation required for the user's outcome",
        requirement.id,
      );
  const witnessed = new Set(
    plan.requirements.flatMap((requirement) =>
      requirement.operation ? [requirement.operation] : [],
    ),
  );
  for (const operation of selected)
    if (!witnessed.has(operation))
      invalid(
        "EXCESS_OPERATION",
        "The plan requests an operation with no necessary outcome requirement",
        operation,
      );
  const fabric = new ConnectorFabric();
  for (const resource of context.resources)
    fabric.register(resource.id, {
      describe: async () => resource,
      invoke: async () => {
        throw new Error("Planning cannot execute connectors");
      },
    });
  await fabric.discover();
  const metadata = fabric.validateDraft({
    name: program.name,
    description: program.description,
    reads: program.reads,
    actions: program.actions,
    trigger: program.trigger,
    source: "Planning contract only",
    tests: [],
    ...(program.postconditions.length
      ? { postconditions: program.postconditions }
      : {}),
  });
  if (
    program.permissions !== undefined &&
    digest([...program.permissions].sort()) !== digest(metadata.permissions)
  )
    invalid(
      "PERMISSION_MISMATCH",
      "The plan's proposed permissions differ from the exact operation-derived authority",
    );
  return {
    plan: {
      ...plan,
      program: { ...program, permissions: metadata.permissions },
    },
    missingConnections: [],
    metadata,
  };
}

export function planningMemory(context: PlanningContext) {
  const active = context.existing.find(
    (tool) => tool.id === (context.editTargetId ?? context.followUpId),
  );
  return {
    activeTool: active
      ? {
          id: active.id,
          version: active.version,
          objective: active.goal,
          reads: active.reads,
          actions: active.actions,
          trigger: active.trigger,
        }
      : null,
    explicitEdit: context.editTargetId ?? null,
    recentRequests: context.conversation
      .filter((turn) => turn.role === "user")
      .slice(-2)
      .map((turn) => turn.text),
    resourceBindings: context.resources.map(({ id, binding, status }) => ({
      id,
      binding,
      status,
    })),
    authorityTransfers: false,
  };
}
