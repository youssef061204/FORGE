import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
export async function connectSimulator(
  token?: string,
  mode: "product" | "fixture" = "product",
) {
  const client = new Client({
    name: "FORGE independent Alexa+-style simulator",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(
      mode === "fixture" ? "/api/mcp/fixture" : "/api/mcp",
      window.location.origin,
    ),
    {
      requestInit: token
        ? { headers: { Authorization: `Bearer ${token}` } }
        : undefined,
    },
  );
  await client.connect(transport);
  return client;
}
export function negotiatedProtocol(client: Client) {
  return client.transport instanceof StreamableHTTPClientTransport
    ? client.transport.protocolVersion
    : undefined;
}
