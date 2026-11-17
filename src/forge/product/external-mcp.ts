import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { SecretVault } from "../vault";
import type {
  FabricConnector,
  ConnectionConfig,
  CallContext,
  OperationDescriptor,
} from "./contracts";
import { assertAllowedUrl, secureFetch } from "./network";
import { assertValidSchema, boundJson, stripSchemaMetadata } from "./schemas";

export class ExternalMcpConnector implements FabricConnector {
  private operations: OperationDescriptor[] = [];
  constructor(
    private config: ConnectionConfig,
    private vault: SecretVault,
    private testClient?: Client,
  ) {
    assertAllowedUrl(config.baseUrl, config.domains);
  }
  private async withClient<T>(task: (client: Client) => Promise<T>) {
    if (this.testClient) return task(this.testClient);
    const credential = (await this.vault.get("connector:" + this.config.id)) as
      | { kind: "bearer" | "api-key"; token: string; header?: string }
      | undefined;
    if (credential?.kind === "api-key")
      throw new Error(
        "External MCP supports only vault-stored bearer authentication",
      );
    const client = new Client({
      name: "FORGE connector fabric",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(this.config.baseUrl),
      {
        requestInit: {
          headers:
            credential?.kind === "bearer"
              ? { Authorization: "Bearer " + credential.token }
              : {},
        },
        fetch: (raw, init) => {
          return secureFetch(raw, init ?? {}, this.config.domains);
        },
      },
    );
    try {
      await client.connect(transport);
      return await task(client);
    } finally {
      await client.close();
    }
  }
  async discover() {
    return this.withClient(async (client) => {
      const result = await client.listTools();
      if (result.nextCursor || result.tools.length > 100)
        throw new Error(
          "External MCP tool list exceeds bounded discovery; narrow the server",
        );
      const tools = result.tools.filter((t) =>
        this.config.operationAllowlist.includes(t.name),
      );
      if (!tools.length)
        throw new Error(
          "No external MCP tools match the owner operation allowlist",
        );
      this.operations = tools.map((tool) => {
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(tool.name))
          throw new Error("External tool name cannot be normalized safely");
        const inputSchema = stripSchemaMetadata(tool.inputSchema);
        const outputSchema = tool.outputSchema
          ? stripSchemaMetadata(tool.outputSchema)
          : { type: "object", additionalProperties: true };
        assertValidSchema(inputSchema);
        assertValidSchema(outputSchema);
        // An external server's hints cannot grant read authority. The owner
        // explicitly classifies reads; everything else requires write consent.
        const read = this.config.readOperations.includes(tool.name);
        return {
          id: this.config.id + "." + tool.name,
          connector: this.config.id,
          name: tool.name,
          description: (tool.description ?? tool.name).slice(0, 500),
          inputSchema,
          outputSchema,
          permission:
            this.config.id + "." + tool.name + (read ? ".read" : ".write"),
          kind: read ? ("read" as const) : ("write" as const),
          sideEffect: read ? ("none" as const) : ("irreversible" as const),
          idempotent: read,
        };
      });
      return this.operations;
    });
  }
  async describe() {
    if (!this.operations.length) await this.discover();
    return {
      id: this.config.id,
      name: this.config.name,
      kind: "mcp" as const,
      status: this.config.enabled
        ? ("connected" as const)
        : ("needs_consent" as const),
      mode: "live" as const,
      binding: this.config.binding,
      setup: "Inspect / Connections",
      constraints: {
        server: this.config.baseUrl,
        domains: this.config.domains,
        ownerOperationAllowlist: this.config.operationAllowlist,
        externalHintsGrantAuthority: false,
        rawNetwork: false,
      },
      operations: this.operations,
    };
  }
  async invoke(
    id: string,
    args: Record<string, unknown>,
    context: CallContext,
  ) {
    const operation = this.operations.find((o) => o.id === id);
    if (!operation || !this.config.enabled)
      throw new Error("External MCP operation unavailable");
    if (context.mode === "replay" && operation.kind === "write")
      throw new Error("Replay cannot invoke an external MCP write");
    return this.withClient(async (client) => {
      const result = await client.callTool(
        { name: id.slice(this.config.id.length + 1), arguments: args },
        undefined,
        { timeout: 15000 },
      );
      if (result.isError)
        throw new Error(
          "External MCP tool failed; no substitute response was used",
        );
      const structured = result.structuredContent;
      const data =
        structured && typeof structured === "object"
          ? structured
          : { content: result.content };
      boundJson(data);
      return { data, target: operation.id };
    });
  }
}
