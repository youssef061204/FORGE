import { digest } from "../hash";
import type { ConnectorFabric } from "./fabric";
import type {
  EffectVerification,
  ProgramDraft,
  ProgramOutput,
  Receipt,
  RunVerification,
} from "./contracts";
import { assertValidSchema, boundJson, validateJson } from "./schemas";
import { workspaceEffectValue } from "./workspace";

function assertSynchronousSchema(value: unknown) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(assertSynchronousSchema);
    return;
  }
  const schema = value as Record<string, unknown>;
  if (schema.$async === true)
    throw new Error(
      "Postconditions require synchronous JSON Schema validation",
    );
  for (const [key, child] of Object.entries(schema)) {
    if (["const", "enum", "default", "example", "examples"].includes(key))
      continue;
    if (
      [
        "properties",
        "$defs",
        "definitions",
        "patternProperties",
        "dependentSchemas",
      ].includes(key) &&
      child &&
      typeof child === "object"
    )
      Object.values(child).forEach(assertSynchronousSchema);
    else assertSynchronousSchema(child);
  }
}

/** Validate the approved verification contract without invoking any connector. */
export function validatePostconditions(
  draft: ProgramDraft,
  fabric: ConnectorFabric,
) {
  if (draft.representation) boundJson(draft.representation, 65536);
  if (!draft.postconditions) return;
  boundJson(draft.postconditions, 32768);
  for (const condition of draft.postconditions) {
    if (condition.kind === "artifact") {
      if (!draft.actions.includes("workspace.save"))
        throw new Error(
          "Artifact postcondition requires the declared workspace.save action",
        );
    } else if (condition.kind === "effect") {
      if (!draft.actions.includes(condition.operation))
        throw new Error("Effect postcondition references an undeclared action");
      if (condition.arguments)
        validateJson(
          fabric.operation(condition.operation).inputSchema,
          condition.arguments,
          "Postcondition effect arguments",
        );
    } else {
      if (!draft.reads.some((read) => read.operation === condition.operation))
        throw new Error(
          "Postcondition readback must use a declared read operation",
        );
      const operation = fabric.operation(condition.operation);
      if (operation.kind !== "read")
        throw new Error(
          "Postcondition readback cannot invoke a write operation",
        );
      validateJson(
        operation.inputSchema,
        condition.arguments,
        "Postcondition readback arguments",
      );
    }
    if ("schema" in condition && condition.schema) {
      assertSynchronousSchema(condition.schema);
      assertValidSchema(condition.schema);
    }
  }
}

/** Reject demonstrably incomplete proposals before granting them any effects. */
export function validateProposedPostconditions(
  draft: ProgramDraft,
  output: ProgramOutput,
) {
  for (const condition of draft.postconditions ?? []) {
    if (condition.kind === "effect") {
      const matching = output.operations.filter(
        (action) =>
          action.operation === condition.operation &&
          (!condition.arguments ||
            digest(action.arguments) === digest(condition.arguments)),
      );
      if (matching.length !== condition.count)
        throw new Error(
          "Proposed operations do not satisfy the declared effect postcondition",
        );
    }
    if (condition.kind === "artifact") {
      const matching = output.operations.filter(
        (action) =>
          action.operation === "workspace.save" &&
          action.arguments.name === condition.name &&
          action.arguments.format === condition.format,
      );
      if (matching.length !== 1)
        throw new Error(
          "Proposed operations do not create the declared output artifact",
        );
      if (condition.schema)
        validateJson(
          condition.schema,
          workspaceEffectValue(matching[0].arguments).content,
          "Proposed output postcondition",
        );
    }
  }
}

export type CommittedEffect = {
  key: string;
  action: ProgramOutput["operations"][number];
  receipt: Receipt;
};

/**
 * Connector hooks and fresh reads confirm committed state, not acknowledgements.
 * No writes occur here. A failed check never clears a committed outbox entry.
 */
export async function verifyCommittedRun(input: {
  draft: ProgramDraft;
  effects: CommittedEffect[];
  fabric: ConnectorFabric;
  now: string;
  observations: Record<string, unknown>;
  assertAuthority: () => Promise<void>;
}): Promise<RunVerification> {
  const started = performance.now();
  const checks: RunVerification["checks"] = [];
  const confirmations: EffectVerification[] = [];
  for (const effect of input.effects) {
    try {
      await input.assertAuthority();
      confirmations.push(
        await input.fabric.verify(
          effect.action.operation,
          effect.action.arguments,
          {
            key: effect.key,
            mode: "live",
            now: input.now,
            observations: input.observations,
            receipt: effect.receipt,
          },
        ),
      );
    } catch {
      confirmations.push({
        status: "failed",
        reason:
          "Committed-state verification failed; inspect the recorded receipt before retrying",
      });
    }
  }

  for (const condition of input.draft.postconditions ?? []) {
    if (condition.kind !== "readback") continue;
    const name = "Readback: " + condition.operation;
    try {
      await input.assertAuthority();
      const response = await input.fabric.invoke(
        condition.operation,
        condition.arguments,
        {
          key: digest({ verification: condition, now: input.now }),
          mode: "replay",
          now: input.now,
          observations: input.observations,
        },
      );
      validateJson(
        condition.schema,
        response.data,
        "Committed readback postcondition",
      );
      checks.push({
        name,
        status: "verified",
        details: "Fresh declared readback satisfies its approved schema",
      });
    } catch {
      checks.push({
        name,
        status: "failed",
        details: "Fresh declared readback did not confirm the expected state",
      });
    }
  }

  for (let index = 0; index < input.effects.length; index++) {
    const confirmation = confirmations[index];
    const effect = input.effects[index];
    checks.push({
      name: "Effect state: " + effect.action.operation,
      status: confirmation.status,
      details: confirmation.reason.slice(0, 500),
    });
  }

  for (const condition of input.draft.postconditions ?? []) {
    if (condition.kind === "readback") continue;
    if (condition.kind === "effect") {
      const matching = input.effects
        .map((effect, index) => ({ effect, index }))
        .filter(
          ({ effect }) =>
            effect.action.operation === condition.operation &&
            (!condition.arguments ||
              digest(effect.action.arguments) === digest(condition.arguments)),
        );
      const status =
        matching.length !== condition.count
          ? "failed"
          : matching.some(
                ({ index }) => confirmations[index].status === "failed",
              )
            ? "failed"
            : matching.some(
                  ({ index }) => confirmations[index].status === "unverified",
                )
              ? "unverified"
              : "verified";
      checks.push({
        name: "Expected effect: " + condition.operation,
        status,
        details:
          status === "verified"
            ? "Expected operation count, arguments and committed-state confirmation passed"
            : status === "unverified"
              ? "The connector acknowledged the operation but its resulting state could not be independently confirmed"
              : "Expected committed operation state was not confirmed",
      });
    } else {
      const matching = input.effects
        .map((effect, index) => ({ effect, index }))
        .filter(
          ({ effect }) =>
            effect.action.operation === "workspace.save" &&
            effect.action.arguments.name === condition.name &&
            effect.action.arguments.format === condition.format,
        );
      try {
        if (
          matching.length !== 1 ||
          confirmations[matching[0].index].status !== "verified"
        )
          throw new Error("Artifact was not confirmed");
        const confirmation = confirmations[matching[0].index];
        if (!confirmation.data)
          throw new Error("Artifact readback unavailable");
        const persisted = workspaceEffectValue(confirmation.data);
        if (
          persisted.name !== condition.name ||
          persisted.format !== condition.format
        )
          throw new Error("Artifact identity differs");
        if (condition.schema)
          validateJson(
            condition.schema,
            persisted.content,
            "Persisted artifact postcondition",
          );
        checks.push({
          name: "Output artifact: " + condition.name,
          status: "verified",
          details:
            "Fresh persisted artifact identity, content integrity and declared schema passed",
        });
      } catch {
        checks.push({
          name: "Output artifact: " + condition.name,
          status: "failed",
          details:
            "The persisted output artifact did not satisfy its declared postcondition",
        });
      }
    }
  }
  if (!input.draft.postconditions?.length)
    checks.push({
      name: "Mission postconditions",
      status: "unverified",
      details:
        "Execution alone does not establish mission success; this program declares no goal postconditions",
    });
  return {
    status: checks.some((check) => check.status === "failed")
      ? "failed"
      : checks.some((check) => check.status === "unverified")
        ? "unverified"
        : "verified",
    checks,
    durationMs: performance.now() - started,
  };
}
