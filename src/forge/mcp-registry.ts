import {
  McpServer,
  type RegisteredTool,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolInputSchema, toolOutputSchema } from "./contracts";
import { assertRelease, type ForgeService } from "./service";
import type { Release } from "./records";
import { eventSchema } from "./spec";
import { simulationControlSchema } from "./city-contracts";
import { programHash } from "./product/runtime";
import type { Program } from "./product/contracts";

export interface ToolChangeAdapter {
  readonly strategy: "rediscover" | "sdk-notification";
  notifyToolsChanged(): Promise<void>;
}
export class StatelessToolChanges implements ToolChangeAdapter {
  readonly strategy = "rediscover" as const;
  async notifyToolsChanged() {
    /* tools/list reloads persisted state; no persistent stateless HTTP client. */
  }
}
export class SdkToolChanges implements ToolChangeAdapter {
  readonly strategy = "sdk-notification" as const;
  constructor(private server: McpServer) {}
  async notifyToolsChanged() {
    await this.server.sendToolListChanged();
  }
}
export type ToolDescriptor = {
  name: string;
  description: string;
  version?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};
export class McpToolRegistry {
  private tools = new Map<
    string,
    { descriptor: ToolDescriptor; handle: RegisteredTool }
  >();
  constructor(
    private server: McpServer,
    private service: ForgeService,
    private changes: ToolChangeAdapter = new StatelessToolChanges(),
    private includeProduct = true,
  ) {}
  registerTool(release: Release) {
    assertRelease(release, release.digest);
    if (!release.approvedAt || release.status !== "installed")
      throw new Error(
        "Only approved installed releases may be exposed as MCP tools",
      );
    const cap = release.definition;
    if (this.tools.has(cap.toolContract.name))
      throw new Error("Duplicate MCP tool name");
    const handle = this.server.registerTool(
      cap.toolContract.name,
      {
        description: `${cap.description} Installed version ${cap.version}. ${cap.executable ? "Connector authority is checked at execution; replay/shadow never commit external writes." : "External adapters use deterministic fixtures."}`,
        inputSchema: toolInputSchema(cap.trigger),
        outputSchema: toolOutputSchema,
        annotations: {
          readOnlyHint: !cap.permissions.some((p) => p.endsWith(".write")),
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: Boolean(cap.executable),
        },
      },
      async (args: z.infer<ReturnType<typeof toolInputSchema>>) => {
        try {
          const payload =
            "jobPosting" in args
              ? { posting: args.jobPosting }
              : { text: args.text };
          const execution = await this.service.trigger(cap.id, {
            id: args.eventId,
            type: cap.trigger,
            payload,
          });
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(execution) },
            ],
            structuredContent: execution,
            isError: execution.status === "failed",
          };
        } catch (e) {
          return {
            content: [
              {
                type: "text" as const,
                text: e instanceof Error ? e.message : "Invocation failed",
              },
            ],
            isError: true,
          };
        }
      },
    );
    this.tools.set(cap.toolContract.name, {
      descriptor: {
        name: cap.toolContract.name,
        description: cap.description,
        version: cap.version,
        inputSchema: cap.toolContract.inputSchema,
        outputSchema: cap.toolContract.outputSchema,
      },
      handle,
    });
  }
  updateTool(release: Release) {
    this.removeTool(release.definition.toolContract.name);
    this.registerTool(release);
  }
  registerProgram(program: Program) {
    if (
      !this.service.product ||
      program.status !== "ready" ||
      program.hash !== programHash(program) ||
      program.permissions.some((p) => !program.grants.includes(p))
    )
      throw new Error("Only an approved intact tool may be exposed");
    const name = "tool_" + program.id.replace(/-/g, "_");
    const inputSchema = {
      eventId: z.string().min(1).max(200).optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    };
    const handle = this.server.registerTool(
      name,
      {
        description:
          program.description +
          " Installed version " +
          program.version +
          ". Current owner grants are checked on every operation.",
        inputSchema,
        annotations: {
          readOnlyHint: program.actions.length === 0,
          destructiveHint: program.actions.length > 0,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          const run = await this.service.product!.run(
            program.id,
            args.eventId,
            args.input,
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(run) }],
            structuredContent: run,
            isError: run.status === "failed",
          };
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "The tool could not run; check its current connection and approval in FORGE",
              },
            ],
            isError: true,
          };
        }
      },
    );
    this.tools.set(name, {
      descriptor: {
        name,
        description: program.description,
        version: program.version,
        inputSchema: z.toJSONSchema(z.object(inputSchema)),
      },
      handle,
    });
  }
  removeTool(name: string) {
    this.tools.get(name)?.handle.remove();
    this.tools.delete(name);
  }
  listTools(): ToolDescriptor[] {
    return [...this.tools.values()].map((t) => t.descriptor);
  }
  async notifyToolsChanged() {
    await this.changes.notifyToolsChanged();
  }
  async sync() {
    const state = await this.service.store.read();
    const installed = state.releases.filter((r) => r.status === "installed");
    const names = new Set(installed.map((r) => r.definition.toolContract.name));
    const programs =
      this.includeProduct && this.service.product
        ? (state.product?.programs.filter((p) => p.status === "ready") ?? [])
        : [];
    for (const program of programs)
      names.add("tool_" + program.id.replace(/-/g, "_"));
    for (const name of this.tools.keys())
      if (!names.has(name)) this.removeTool(name);
    for (const release of installed) {
      const current = this.tools.get(release.definition.toolContract.name);
      if (!current) this.registerTool(release);
      else if (current.descriptor.version !== release.definition.version)
        this.updateTool(release);
    }
    for (const program of programs) {
      const name = "tool_" + program.id.replace(/-/g, "_");
      const current = this.tools.get(name);
      if (current?.descriptor.version !== program.version) {
        this.removeTool(name);
        this.registerProgram(program);
      }
    }
  }
}
export async function createForgeMcpServer(
  service: ForgeService,
  options: { fixtures?: boolean } = {},
) {
  const product = options.fixtures ? undefined : service.product;
  const server = new McpServer({ name: "FORGE", version: "0.1.0" });
  const response = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  server.registerTool(
    "forge.build",
    {
      description:
        "Compile a natural-language request into a tested permission-scoped MCP tool proposal. Human approval in the simulator is required to install it.",
      inputSchema: {
        request: z.string().min(5).max(4000),
        buildId: z.string().uuid().optional(),
        followUpId: z.string().max(64).optional(),
      },
    },
    async ({ request, buildId, followUpId }) =>
      response(
        product
          ? await product.ask(request, buildId, followUpId)
          : await service.propose(request, buildId),
      ),
  );
  server.registerTool(
    "forge.inspect",
    {
      description:
        "Inspect capability contracts, permissions, versions, validation evidence and execution traces.",
      inputSchema: {},
    },
    async () =>
      response(product ? await product.snapshot() : await service.snapshot()),
  );
  server.registerTool(
    "forge.create",
    {
      description:
        "Create a tested capability proposal; owner approval remains separate.",
      inputSchema: { request: z.string().min(5).max(4000) },
    },
    async ({ request }) =>
      response(
        product ? await product.ask(request) : await service.propose(request),
      ),
  );
  server.registerTool(
    "forge.list",
    {
      description: "List persisted capability versions and local authority.",
      inputSchema: {},
    },
    async () => {
      const state = await service.store.read();
      if (product)
        return response(
          (state.product?.programs ?? []).map(
            ({ id, name, version, status, permissions, hash }) => ({
              id,
              name,
              version,
              status,
              permissions,
              hash,
            }),
          ),
        );
      return response(
        state.releases.map((r) => ({
          id: r.definition.id,
          version: r.definition.version,
          status: r.status,
          permissions: r.definition.permissions,
          trust: state.live?.trust[r.digest],
        })),
      );
    },
  );
  if (product)
    server.registerTool(
      "forge.run",
      {
        description:
          "Run a tool already approved through the owner interface. No approval can be granted through MCP.",
        inputSchema: {
          id: z.string(),
          eventId: z.string().max(200).optional(),
          input: z.record(z.string(), z.unknown()).optional(),
        },
      },
      async ({ id, eventId, input }) =>
        response(await product.run(id, eventId, input)),
    );
  server.registerTool(
    "forge.preview",
    {
      description:
        "Reality Replay intercepts every write. Google requires an owner-connected binding.",
      inputSchema: {
        id: z.string(),
        version: z.string(),
        digest: z.string().length(64),
        connector: z.enum(["fixture", "google"]).default("fixture"),
      },
    },
    async ({ id, version, digest, connector }) =>
      response(await service.replay(id, version, digest, connector)),
  );
  server.registerTool(
    "forge.approve",
    {
      description:
        "Request human review. This tool cannot grant authority; approval occurs through the owner interface.",
      inputSchema: { id: z.string(), version: z.string() },
    },
    async ({ id, version }) =>
      product
        ? response({
            approvalRequired: true,
            ownerReview: "/tools#" + id,
            proposal:
              (await service.store.read()).product?.programs.find(
                (program) =>
                  program.id === id &&
                  program.version === version &&
                  program.status === "review",
              ) ?? null,
          })
        : response({
            approvalRequired: true,
            ownerReview: "/live",
            admission: await service.admission(id, version),
          }),
  );
  server.registerTool(
    "forge.execute",
    {
      description:
        "Execute an already approved capability by ID; broker checks current deployment grants.",
      inputSchema: { id: z.string(), event: eventSchema },
    },
    async ({ id, event }) => response(await service.trigger(id, event)),
  );
  server.registerTool(
    "forge.rollback",
    {
      description:
        "Restore a previously approved version. Connector write authority is revoked on rollback.",
      inputSchema: { id: z.string(), version: z.string() },
    },
    async ({ id, version }) => response(await service.rollback(id, version)),
  );
  server.registerTool(
    "forge.export",
    {
      description:
        "Export signed software without connector grants, snapshots or request prose. Local development signing is explicitly labeled.",
      inputSchema: { id: z.string(), version: z.string() },
    },
    async ({ id, version }) =>
      response(await service.exportCapsule(id, version)),
  );
  server.registerTool(
    "forge.import",
    {
      description:
        "Verify and retest a signed capsule. Imports start UNTRUSTED with zero authority.",
      inputSchema: { json: z.string().max(60000) },
    },
    async ({ json }) => response(await service.importCapsule(JSON.parse(json))),
  );
  server.registerTool(
    "forge.goal",
    {
      description:
        "Interpret a goal in the discovered DIGITAL TWIN environment, generate algorithms and compare actual stochastic Futures. Returns a job id; admission requires owner approval.",
      inputSchema: {
        request: z.string().min(5).max(4000),
        previousId: z.string().max(64).optional(),
      },
    },
    async ({ request, previousId }) =>
      response(await service.city.request(request, previousId)),
  );
  server.registerTool(
    "forge.controller",
    {
      description:
        "Compare a measured host signal or responder controller in private Futures. No deployment until exact owner approval.",
      inputSchema: {
        kind: z.enum(["pressure", "optimizer", "rl", "hybrid", "placement"]),
      },
    },
    async ({ kind }) =>
      response(
        await service.city.request(
          "Compare the selected " + kind + " controller",
          undefined,
          kind,
        ),
      ),
  );
  server.registerTool(
    "forge.environment",
    {
      description:
        "Observe or query the authoritative DIGITAL TWIN and discover resources, actuators and constraints.",
      inputSchema: {
        resourceId: z.string().max(64).optional(),
        environment: z.enum(["city", "google"]).default("city"),
      },
    },
    async ({ resourceId, environment }) => {
      if (environment === "google")
        return response(
          resourceId
            ? await service.connectedEnvironment.query(resourceId)
            : {
                observation: await service.connectedEnvironment.observe(),
                capabilities:
                  service.connectedEnvironment.describeCapabilities(),
                constraints: service.connectedEnvironment.describeConstraints(),
              },
        );
      return response(
        resourceId
          ? await service.city.provider.query(resourceId)
          : {
              observation: await service.city.provider.observe(),
              capabilities: service.city.provider.describeCapabilities(),
              constraints: service.city.provider.describeConstraints(),
            },
      );
    },
  );
  server.registerTool(
    "forge.futures",
    {
      description:
        "Read actual persisted candidate source, stochastic rollouts, safety failures and admission evidence.",
      inputSchema: { contestId: z.string().uuid() },
    },
    async ({ contestId }) =>
      response(
        (await service.store.read()).contests?.find(
          (c) => c.id === contestId,
        ) ?? { error: "Unknown contest" },
      ),
  );
  const registry = new McpToolRegistry(
    server,
    service,
    new StatelessToolChanges(),
    !options.fixtures,
  );
  server.registerTool(
    "forge.mission",
    {
      description:
        "Submit an owner mission, optionally using persistent owner conversation context. Compilation and Futures never grant authority.",
      inputSchema: {
        request: z.string().min(5).max(3000),
        followUp: z.boolean().default(false),
      },
    },
    async ({ request, followUp }) =>
      response(await service.lab.mission(request, followUp)),
  );
  server.registerTool(
    "forge.rehearse",
    {
      description:
        "Run 20 paired what-if, chaos or action-ablation trials in isolated City forks. Does not change the current City or grant authority.",
      inputSchema: {
        digest: z.string().length(64),
        kind: z.enum(["what-if", "chaos", "ablation"]),
        change: simulationControlSchema.optional(),
        operation: z.string().max(40).optional(),
      },
    },
    async (args) =>
      response(await service.lab.command({ action: "experiment", ...args })),
  );
  server.registerTool(
    "forge.evidence",
    {
      description:
        "Read mission memory, measured experiments and uncertainty, or issue an integrity-signed evaluation passport without raw goals or snapshots.",
      inputSchema: { contestId: z.string().uuid().optional() },
    },
    async ({ contestId }) =>
      response(
        contestId
          ? await service.lab.passport(contestId)
          : await service.lab.snapshot(),
      ),
  );
  server.registerTool(
    "forge.briefing",
    {
      description:
        "Give a concise voice-ready briefing grounded in current City metrics, deployed policy and measured sampling uncertainty.",
      inputSchema: {},
    },
    async () => response(await service.lab.briefing()),
  );
  await registry.sync();
  server.server.registerCapabilities({ tools: { listChanged: false } });
  return { server, registry };
}
