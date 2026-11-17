import { z } from "zod";
import { schemaType } from "../executable";
import { digest } from "../hash";
import {
  programInputSchema,
  type ConnectorDescriptor,
  type FabricConnector,
  type OperationDescriptor,
  type ProgramDraft,
  type CallContext,
  type VerificationContext,
  type EffectVerification,
} from "./contracts";
import { boundJson, validateJson } from "./schemas";
import { validatePostconditions } from "./verification";

export class ConnectorFabric {
  private connectors = new Map<string, FabricConnector>();
  private catalog = new Map<string, OperationDescriptor>();
  private descriptors: ConnectorDescriptor[] = [];
  register(id: string, connector: FabricConnector) {
    if (this.connectors.has(id))
      throw new Error("Connector already registered");
    this.connectors.set(id, connector);
  }
  async discover() {
    this.descriptors = await Promise.all(
      [...this.connectors].map(async ([id, connector]) => {
        let descriptor: ConnectorDescriptor;
        try {
          descriptor = await connector.describe();
        } catch {
          descriptor = {
            id,
            name: id,
            kind: "builtin",
            status: "error",
            mode: "live",
            binding: "unavailable",
            setup: "/inspect",
            constraints: {
              reason:
                "Connection discovery failed; reconnect or inspect the connection",
              fixtureFallback: false,
            },
            operations: [],
          };
        }
        if (descriptor.id !== id)
          throw new Error("Connector identity mismatch");
        return descriptor;
      }),
    );
    this.catalog.clear();
    for (const connector of this.descriptors)
      for (const operation of connector.operations) {
        if (
          this.catalog.has(operation.id) ||
          operation.connector !== connector.id
        )
          throw new Error("Operation identity collision");
        this.catalog.set(operation.id, operation);
      }
    return structuredClone(this.descriptors);
  }
  descriptor(id: string) {
    const descriptor = this.descriptors.find((d) => d.id === id);
    if (!descriptor) throw new Error("Unknown connector");
    return structuredClone(descriptor);
  }
  operation(id: string, requireConnected = true) {
    const operation = this.catalog.get(id);
    if (!operation)
      throw new Error(
        "The requested operation is not exposed by a connected resource",
      );
    const connector = this.descriptor(operation.connector);
    if (requireConnected && connector.status !== "connected")
      throw new Error(
        `Connect ${connector.name} before using ${operation.name}`,
      );
    return structuredClone(operation);
  }
  async invoke(
    id: string,
    args: Record<string, unknown>,
    context: CallContext,
  ) {
    const operation = this.operation(id);
    boundJson(args, 32768);
    validateJson(operation.inputSchema, args, operation.name + " input");
    const value = await this.connectors
      .get(operation.connector)!
      .invoke(id, args, context);
    boundJson(value.data);
    validateJson(
      operation.outputSchema,
      value.data,
      operation.name + " response",
    );
    return value;
  }
  async preflight(
    id: string,
    args: Record<string, unknown>,
    context: CallContext,
  ) {
    const operation = this.operation(id);
    validateJson(operation.inputSchema, args, operation.name + " input");
    await this.connectors
      .get(operation.connector)!
      .preflight?.(id, args, context);
  }
  async verify(
    id: string,
    args: Record<string, unknown>,
    context: VerificationContext,
  ): Promise<EffectVerification> {
    const operation = this.operation(id);
    if (
      operation.kind !== "write" ||
      context.receipt.operation !== id ||
      !["committed", "deduplicated"].includes(context.receipt.status)
    )
      throw new Error("Only a committed declared write can be verified");
    validateJson(
      operation.inputSchema,
      args,
      "Verification operation arguments",
    );
    const connector = this.connectors.get(operation.connector)!;
    if (!connector.verify)
      return {
        status: "unverified",
        reason:
          "This connector does not expose safe committed-state verification",
      };
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        connector.verify(id, args, context),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Committed-state verification timed out")),
            5000,
          );
        }),
      ]);
      z.enum(["verified", "failed", "unverified"]).parse(result.status);
      z.string().max(500).parse(result.reason);
      if (result.data !== undefined) boundJson(result.data);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  validateDraft(draft: ProgramDraft) {
    validatePostconditions(draft, this);
    if (draft.trigger.kind === "connector_event") {
      const trigger = draft.trigger;
      if (
        !draft.reads.some(
          (read) =>
            this.operation(read.operation).connector === trigger.connector,
        )
      )
        throw new Error(
          "A connector event must be bound to a declared observation from that connection",
        );
    }
    const operations = [
      ...new Set([...draft.reads.map((r) => r.operation), ...draft.actions]),
    ];
    for (const read of draft.reads) {
      const operation = this.operation(read.operation);
      if (operation.kind !== "read")
        throw new Error("Observation phase cannot contain write operations");
      validateJson(
        operation.inputSchema,
        read.arguments,
        operation.name + " input",
      );
    }
    if (new Set(draft.reads.map((r) => r.ref)).size !== draft.reads.length)
      throw new Error("Duplicate observation reference");
    if (new Set(draft.actions).size !== draft.actions.length)
      throw new Error("Duplicate declared action");
    for (const id of draft.actions)
      if (this.operation(id).kind !== "write")
        throw new Error("Proposed actions must be write operations");
    const descriptors = operations.map((id) => this.operation(id));
    const connectors = [...new Set(descriptors.map((d) => d.connector))].sort();
    return {
      connectors,
      permissions: [...new Set(descriptors.map((d) => d.permission))].sort(),
      bindings: Object.fromEntries(
        connectors.map((id) => [id, this.descriptor(id).binding]),
      ),
    };
  }
  types(draft: Pick<ProgramDraft, "reads" | "actions">) {
    const schema = z.toJSONSchema(programInputSchema) as Record<
      string,
      unknown
    >;
    const properties = schema.properties as Record<
      string,
      Record<string, unknown>
    >;
    properties.observations = {
      type: "object",
      properties: Object.fromEntries(
        draft.reads.map((read) => [
          read.ref,
          this.operation(read.operation).outputSchema,
        ]),
      ),
      required: draft.reads.map((r) => r.ref),
      additionalProperties: false,
    };
    const actions = draft.actions.map((id) => this.operation(id));
    const union =
      actions
        .map(
          (action) =>
            "{ operation: " +
            JSON.stringify(action.id) +
            "; arguments: " +
            schemaType(action.inputSchema) +
            " }",
        )
        .join(" | ") || "never";
    return (
      "type ModuleInput = " +
      schemaType(schema) +
      "; type ModuleOutput = { operations: Array<" +
      union +
      ">; result: { summary: string; details?: string[] }; state?: Record<string, unknown> };"
    );
  }
  fingerprint() {
    return digest(
      this.descriptors.map((d) => ({
        id: d.id,
        binding: d.binding,
        status: d.status,
        operations: d.operations,
      })),
    );
  }
}
