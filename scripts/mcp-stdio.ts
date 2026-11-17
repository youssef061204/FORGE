/**
 * stdio bridge for MCP clients that only speak stdio (npx forge mcp).
 * Relays every message to the local FORGE's Streamable HTTP endpoint and back,
 * including tools/list_changed notifications. Loopback only.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.FORGE_MCP_URL ?? "http://127.0.0.1:3110/api/mcp");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
  console.error("FORGE's MCP bridge only connects to this computer.");
  process.exit(1);
}
const up = new StdioServerTransport();
const down = new StreamableHTTPClientTransport(url);
up.onmessage = (m) => void down.send(m).catch((e) => console.error("forge mcp:", e.message));
down.onmessage = (m) => void up.send(m);
down.onerror = (e) => console.error("forge mcp:", e.message);
up.onclose = () => void down.close().then(() => process.exit(0));
await down.start();
await up.start();
