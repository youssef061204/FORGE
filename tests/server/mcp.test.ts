import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { createServer, type Server } from "node:http";
import { replay } from "../../src/core/events/reducer";
import { Broker } from "../../src/server/broker/broker";
import { BuildService } from "../../src/server/builds";
import { Bus } from "../../src/server/bus";
import { McpHub } from "../../src/server/mcp/hub";
import { SandboxPool } from "../../src/server/sandbox/pool";
import { openDatabase } from "../../src/server/store/db";
import { Repo } from "../../src/server/store/repo";
import { SAMPLES } from "../../src/showcase/samples";

process.env.FORGE_MODEL_TRANSPORT = "scripted";

let http: Server;
let url: string;
let repo: Repo, builds: BuildService, pool: SandboxPool;

/** Bridge node:http to the Web-standard handler the Next route uses. */
beforeAll(async () => {
  repo = new Repo(openDatabase(":memory:"));
  const bus = new Bus();
  pool = new SandboxPool(1);
  builds = new BuildService(repo, bus);
  const hub = new McpHub({ repo, bus, pool, broker: new Broker(repo, pool, bus), builds });
  http = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const response = await hub.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) return res.end();
    const reader = response.body.getReader();
    req.on("close", () => void reader.cancel().catch(() => undefined));
    for (;;) {
      const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (done) break;
      res.write(value);
    }
    res.end();
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  const addr = http.address() as { port: number };
  url = `http://127.0.0.1:${addr.port}/api/mcp`;
});
afterAll(async () => {
  await pool.close();
  http.closeAllConnections();
  await new Promise((r) => http.close(r));
});

async function finished(id: string) {
  for (let i = 0; i < 400; i++) {
    if (repo.build(id)?.status === "done") return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("stateful MCP", () => {
  it("notifies a connected client when a tool is approved and when it is revoked", async () => {
    const client = new Client({ name: "test-assistant", version: "1.0.0" });
    const changes: number[] = [];
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      changes.push(Date.now());
    });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const before = await client.listTools();
    expect(before.tools.map((t) => t.name).sort()).toEqual(["forge_build", "forge_list", "forge_status"]);

    // The assistant asks for a tool. It gets a review link, never an approval.
    const orders = SAMPLES.find((s) => s.id === "orders")!;
    const asked = await client.callTool({ name: "forge_build", arguments: { request: orders.requests[0].text, files: [{ name: "orders.csv", text: orders.file.text }] } });
    const text = (asked.content as { text: string }[])[0].text;
    expect(text).toMatch(/a person has to approve it/);
    const buildId = /Build id: (b_[\w-]+)/.exec(text)![1];
    await finished(buildId);
    const noApproveTool = (await client.listTools()).tools.find((t) => /approve/i.test(t.name));
    expect(noApproveTool).toBeUndefined();

    // A person approves in the UI; the client hears about it without reconnecting.
    const view = replay(repo.events(buildId), buildId);
    const { tool } = builds.approve(buildId, { hash: view.review!.hash });
    await expect.poll(() => changes.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    const after = await client.listTools();
    const name = after.tools.map((t) => t.name).find((n) => !n.startsWith("forge_"))!;
    expect(name).toBeTruthy();

    const result = await client.callTool({ name, arguments: { orders: "orders.csv", idempotency_key: "k1" } });
    expect(result.isError).toBeFalsy();
    expect((result.content as { text: string }[])[0].text).toMatch(/Wrote totals.json/);

    // Revoke: the tool disappears from the list and the client is told.
    builds.revoke(tool.id);
    await expect.poll(() => changes.length, { timeout: 5000 }).toBeGreaterThanOrEqual(2);
    expect((await client.listTools()).tools.map((t) => t.name)).not.toContain(name);
    await client.close();
  });
});
