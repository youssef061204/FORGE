import { describe, expect, it } from "vitest";
import { handleMcpPost } from "../src/forge/mcp-http";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";

describe("MCP 2025-11-25 Streamable HTTP boundary", () => {
  const service = new ForgeService(new MemoryStateStore());
  const send = (body: unknown, headers: Record<string, string> = {}) =>
    handleMcpPost(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2025-11-25",
          ...headers,
        },
        body: JSON.stringify(body),
      }),
      service,
    );
  it("negotiates the required version, declares stateless capabilities, and preserves string IDs", async () => {
    const response = await send({
      jsonrpc: "2.0",
      id: "init-2025",
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "protocol-test", version: "1" },
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    const envelope = await response.json();
    expect(envelope.jsonrpc).toBe("2.0");
    expect(envelope.id).toBe("init-2025");
    expect(envelope.result.protocolVersion).toBe("2025-11-25");
    expect(envelope.result.capabilities.tools.listChanged).toBe(false);
    const listed = await send({
      jsonrpc: "2.0",
      id: 0,
      method: "tools/list",
      params: {},
    });
    const tools = await listed.json();
    expect(tools.id).toBe(0);
    expect(
      tools.result.tools.map((t: { name: string }) => t.name).slice(0, 2),
    ).toEqual(["forge.build", "forge.inspect"]);
    expect(tools.result.tools[0].inputSchema.type).toBe("object");
    expect(tools.result.tools[0].inputSchema.required).toContain("request");
  });
  it("negotiates unknown versions to the supported latest version", async () => {
    const response = await send({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        protocolVersion: "2099-01-01",
        capabilities: {},
        clientInfo: { name: "future", version: "1" },
      },
    });
    expect((await response.json()).result.protocolVersion).toBe("2025-11-25");
  });
  it("accepts notifications with an empty 202 and rejects unsupported protocol headers", async () => {
    const response = await send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
    expect(
      (
        await send(
          { jsonrpc: "2.0", id: 4, method: "tools/list" },
          { "MCP-Protocol-Version": "2099-01-01" },
        )
      ).status,
    ).toBe(400);
  });
  it("returns protocol errors with the original ID, and tool errors for invalid calls", async () => {
    const response = await send({
      jsonrpc: "2.0",
      id: "unknown",
      method: "unknown/method",
    });
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: "unknown",
      error: { code: -32601 },
    });
    const call = await send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "forge.build", arguments: { request: 42 } },
    });
    expect(await call.json()).toMatchObject({
      id: 6,
      result: { isError: true },
    });
  });
  it("rejects batches and invalid envelopes as invalid requests, and malformed JSON as parse errors", async () => {
    for (const body of [
      [],
      [{ jsonrpc: "2.0", id: 1, method: "tools/list" }],
      null,
      { jsonrpc: "1.0", id: "bad", method: "tools/list" },
    ]) {
      const response = await send(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(-32600);
    }
    const response = await handleMcpPost(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
      service,
    );
    expect(await response.json()).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700 },
    });
  });
  it("enforces transport media negotiation", async () => {
    const body = { jsonrpc: "2.0", id: 7, method: "tools/list" };
    expect((await send(body, { Accept: "application/json" })).status).toBe(406);
    expect((await send(body, { "Content-Type": "text/plain" })).status).toBe(
      415,
    );
  });
});
