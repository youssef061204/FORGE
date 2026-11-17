import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import { createForgeMcpServer } from "./mcp-registry";
import { HttpAccessError, readJson } from "./http";
import type { ForgeService } from "./service";
import { logRequest } from "./telemetry";

export async function handleMcpPost(
  request: Request,
  service: ForgeService,
  options: { fixtures?: boolean } = {},
) {
  const started = performance.now();
  // Let the SDK enforce media negotiation; validate the single-message boundary
  // ourselves because its legacy transport also accepts pre-2025 JSON-RPC batches.
  let parsedBody: unknown;
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      parsedBody = await readJson(request);
    } catch (error) {
      if (error instanceof HttpAccessError) throw error;
      return rpcError(-32700, "Parse error", null);
    }
    if (!JSONRPCMessageSchema.safeParse(parsedBody).success) {
      const id =
        parsedBody && typeof parsedBody === "object" && "id" in parsedBody
          ? parsedBody.id
          : null;
      return rpcError(
        -32600,
        "Invalid Request: expected one JSON-RPC 2.0 message",
        typeof id === "string" || typeof id === "number" ? id : null,
      );
    }
  }
  const { server } = await createForgeMcpServer(service, options);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: 65536,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request, { parsedBody });
    const method =
      parsedBody && typeof parsedBody === "object" && "method" in parsedBody
        ? parsedBody.method
        : "other";
    logRequest({
      transport: "mcp",
      method:
        typeof method === "string" &&
        [
          "initialize",
          "tools/list",
          "tools/call",
          "notifications/initialized",
          "ping",
        ].includes(method)
          ? method
          : "other",
      status: response.status,
      durationMs: Math.round(performance.now() - started),
    });
    return response;
  } finally {
    await server.close();
  }
}

function rpcError(code: number, message: string, id: string | number | null) {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status: 400 },
  );
}
