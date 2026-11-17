/**
 * Stateful MCP over Streamable HTTP. Each connected assistant gets a session
 * with a server-to-client stream, so the moment a tool is approved or revoked
 * it receives notifications/tools/list_changed without reconnecting.
 *
 * The static surface is three tools: forge_build, forge_status, forge_list.
 * Every approved tool is added as its own MCP tool. No MCP call can approve
 * anything: building returns a review link, and approval happens in the UI.
 */
import { randomUUID } from "node:crypto";
import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { mcpToolName, STATIC_MCP_TOOLS } from "../../core/contracts/tool-name";
import { replay } from "../../core/events/reducer";
import { Denied } from "../broker/broker";
import type { Forge } from "../forge";

type Session = { id: string; server: McpServer; transport: WebStandardStreamableHTTPServerTransport; tools: Map<string, RegisteredTool>; client?: string; at: string };

const BASE = () => process.env.FORGE_PUBLIC_URL ?? "http://127.0.0.1:3110";

function caption(msg: Record<string, unknown>, dir: "in" | "out", names: Map<string | number, string>): string {
  const method = msg.method as string | undefined;
  const params = (msg.params ?? {}) as Record<string, unknown>;
  if (method === "initialize") return `The assistant connects${(params.clientInfo as { name?: string })?.name ? ` as ${(params.clientInfo as { name: string }).name}` : ""}.`;
  if (method === "notifications/initialized") return "The assistant is ready.";
  if (method === "tools/list") return "The assistant asks which tools exist.";
  if (method === "tools/call") return `The assistant calls ${params.name as string}.`;
  if (method === "notifications/tools/list_changed") return "FORGE tells the assistant its tool list changed.";
  if (method === "notifications/progress") return "FORGE reports progress.";
  if (dir === "out" && "result" in msg) {
    const was = names.get(msg.id as string | number);
    const result = msg.result as { tools?: unknown[]; isError?: boolean };
    if (result.tools) return `FORGE lists ${result.tools.length} tools.`;
    if (result.isError) return `FORGE refuses${was ? ` ${was}` : ""}.`;
    return `FORGE answers${was ? ` ${was}` : ""}.`;
  }
  if ("error" in msg) return "FORGE returns an error.";
  return method ?? "message";
}

export class McpHub {
  private sessions = new Map<string, Session>();
  constructor(private readonly forge: Forge) {
    forge.bus.on((e) => {
      if (e.t === "tools.changed") for (const s of this.sessions.values()) this.sync(s);
    });
  }

  list() {
    return [...this.sessions.values()].map((s) => ({ id: s.id, client: s.client, at: s.at, tools: [...s.tools.keys()] }));
  }

  private wire(session: string, direction: "in" | "out", message: unknown, names: Map<string | number, string>) {
    const msgs = Array.isArray(message) ? message : [message];
    for (const m of msgs)
      if (m && typeof m === "object") {
        const rec = m as Record<string, unknown>;
        if (direction === "in" && rec.method === "tools/call") names.set(rec.id as string, (rec.params as { name: string }).name);
        this.forge.bus.publish({ t: "mcp.wire", session, direction, message: m, caption: caption(rec, direction, names), at: new Date().toISOString() });
      }
  }

  /** Add tools that were approved, remove ones that were revoked. The SDK notifies the client. */
  private sync(s: Session) {
    const { repo, broker } = this.forge;
    const active = repo.tools().filter((t) => t.status === "active" && t.currentVersion);
    const wanted = new Map(active.map((t) => [mcpToolName(t.name, t.id), t]));
    for (const [name, reg] of s.tools)
      if (!wanted.has(name)) {
        reg.remove();
        s.tools.delete(name);
      }
    for (const [name, t] of wanted) {
      if (s.tools.has(name)) continue;
      const v = repo.version(t.id, t.currentVersion!)!;
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const i of v.recipe.inputs)
        shape[i.slot] = z.string().describe(`The ${i.slot} file: a workspace file name or id, or the file's contents inline (CSV, TSV, JSON or text).`);
      shape.idempotency_key = z.string().max(200).optional().describe("Repeat calls with the same key never write twice.");
      const reg = s.server.registerTool(
        name,
        {
          title: t.name,
          description: `${t.description}\n\nSteps:\n${v.english.map((l, k) => `${k + 1}. ${l}`).join("\n")}\n\nPermissions: ${v.passport.can.map((c) => c.text).join("; ")}.`,
          inputSchema: shape,
          annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false, idempotentHint: true },
        },
        async (args: Record<string, unknown>) => {
          const files = repo.files(200);
          const inputs = v.recipe.inputs.map((i) => {
            const given = String(args[i.slot] ?? "");
            const byRef = files.find((f) => f.id === given || f.name === given);
            if (byRef) return { slot: i.slot, fileId: byRef.id };
            return { slot: i.slot, inline: { name: `${i.slot}.${given.trim().startsWith("{") || given.trim().startsWith("[") ? "json" : "csv"}`, text: given } };
          });
          try {
            const out = await broker.run(t.id, inputs, { eventKey: args.idempotency_key ? `mcp:${String(args.idempotency_key)}` : undefined, trigger: "mcp" });
            const parts = [`${out.run.summary}${out.deduplicated ? " (already handled; nothing new was written)" : ""}`];
            for (const a of out.artifacts) parts.push(`${a.name} (${a.bytes} bytes): ${BASE()}/api/artifacts/${a.id}\n${a.text.slice(0, 4000)}${a.text.length > 4000 ? "\n…" : ""}`);
            return { content: [{ type: "text" as const, text: parts.join("\n\n") }], isError: out.run.status !== "done" };
          } catch (error) {
            const msg = error instanceof Denied ? `Refused by FORGE (${error.layer}): ${error.message}` : `The tool failed: ${(error as Error).message}`;
            return { content: [{ type: "text" as const, text: msg }], isError: true };
          }
        },
      );
      s.tools.set(name, reg);
    }
  }

  private create(): Session {
    const server = new McpServer({ name: "forge", version: "2.0.0" }, { capabilities: { tools: { listChanged: true } }, instructions: "FORGE builds tools you are missing. Call forge_build with a plain-language request; a person approves the result in FORGE, and then it appears in your tool list." });
    const session: Session = { id: "", server, transport: undefined as never, tools: new Map(), at: new Date().toISOString() };
    const names = new Map<string | number, string>();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        session.id = id;
        this.sessions.set(id, session);
      },
      onsessionclosed: (id) => {
        this.sessions.delete(id);
      },
    });
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => {
      this.wire(session.id, "out", message, names);
      return send(message, options);
    };
    session.transport = transport;
    (session as Session & { names: typeof names }).names = names;
    const { repo, builds } = this.forge;
    server.registerTool(
      "forge_build",
      {
        title: "Build a missing tool",
        description: STATIC_MCP_TOOLS[0].description,
        inputSchema: {
          request: z.string().min(3).max(2000).describe("What the tool should do, in plain language."),
          files: z.array(z.object({ name: z.string().max(120), text: z.string().max(10 * 1024 * 1024) })).max(4).optional().describe("Input files, inline."),
          file_ids: z.array(z.string().max(40)).max(4).optional().describe("Files already in the FORGE workspace, by name or id."),
        },
        annotations: { openWorldHint: false },
      },
      async ({ request, files = [], file_ids = [] }) => {
        try {
          const known = repo.files(200);
          const ids = [...files.map((f) => repo.addFile(f.name, f.name.split(".").pop() === "json" ? "json" : f.name.endsWith(".tsv") ? "tsv" : f.name.endsWith(".csv") ? "csv" : "text", f.text, "mcp").id), ...file_ids.map((x) => known.find((k) => k.id === x || k.name === x)?.id).filter((x): x is string => !!x)];
          const id = await builds.start({ request, fileIds: ids });
          return { content: [{ type: "text" as const, text: `Building. Review it at ${BASE()}/forge/${id} — a person has to approve it there before you can call it. Build id: ${id}. Use forge_status to follow it; when approved, it will appear in your tool list.` }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: `FORGE could not start: ${(error as Error).message}` }], isError: true };
        }
      },
    );
    server.registerTool("forge_status", { title: "Build status", description: STATIC_MCP_TOOLS[1].description, inputSchema: { build_id: z.string().max(40) }, annotations: { readOnlyHint: true } }, async ({ build_id }) => {
      const b = repo.build(build_id);
      if (!b) return { content: [{ type: "text" as const, text: "No such build." }], isError: true };
      const v = replay(repo.events(build_id), build_id);
      const state = v.installed
        ? `Approved and installed as ${mcpToolName(v.installed.name, v.installed.toolId)}.`
        : v.review
          ? `Ready for review at ${BASE()}/forge/${build_id}. Waiting for a person to approve it.`
          : v.failure
            ? `Not built: ${v.failure.reason}`
            : v.route && v.route.route !== "SYNTHESIZE"
              ? `${v.route.route}: ${v.route.question ?? v.route.reason}`
              : `In progress: ${v.stage}.`;
      return { content: [{ type: "text" as const, text: state }] };
    });
    server.registerTool("forge_list", { title: "Installed tools", description: STATIC_MCP_TOOLS[2].description, annotations: { readOnlyHint: true } }, async () => {
      const lines = repo
        .tools()
        .filter((t) => t.status === "active")
        .map((t) => {
          const v = repo.version(t.id, t.currentVersion!)!;
          return `${mcpToolName(t.name, t.id)}: ${t.description} [${v.passport.can.map((c) => c.text).join("; ")}]`;
        });
      return { content: [{ type: "text" as const, text: lines.length ? lines.join("\n") : "No tools installed yet. Use forge_build." }] };
    });
    this.sync(session);
    return session;
  }

  async handle(req: Request): Promise<Response> {
    const sid = req.headers.get("mcp-session-id");
    let parsed: unknown;
    if (req.method === "POST") {
      try {
        parsed = await req.clone().json();
      } catch {
        parsed = undefined;
      }
    }
    if (sid) {
      const s = this.sessions.get(sid);
      if (!s) return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found; reconnect." }, id: null }), { status: 404, headers: { "content-type": "application/json" } });
      if (parsed) this.wire(sid, "in", parsed, (s as Session & { names: Map<string | number, string> }).names);
      return s.transport.handleRequest(req, { parsedBody: parsed });
    }
    const isInit = (Array.isArray(parsed) ? parsed : [parsed]).some((m) => m && typeof m === "object" && (m as { method?: string }).method === "initialize");
    if (!isInit) return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Start with initialize." }, id: null }), { status: 400, headers: { "content-type": "application/json" } });
    const s = this.create();
    await s.server.connect(s.transport);
    const init = (Array.isArray(parsed) ? parsed : [parsed]).find((m) => (m as { method?: string })?.method === "initialize") as { params?: { clientInfo?: { name?: string } } } | undefined;
    s.client = init?.params?.clientInfo?.name;
    const res = await s.transport.handleRequest(req, { parsedBody: parsed });
    if (s.id) this.wire(s.id, "in", parsed, (s as Session & { names: Map<string | number, string> }).names);
    return res;
  }
}
