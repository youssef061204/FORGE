import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ForgeService } from "../src/forge/service";
import { MemoryStateStore } from "../src/forge/store";
import {
  createForgeMcpServer,
  McpToolRegistry,
} from "../src/forge/mcp-registry";
import {
  scoutRequest,
  extensionRequest,
  postings,
} from "../src/forge/fixtures";
import { releaseSchema } from "../src/forge/records";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("real MCP tool discovery and invocation", () => {
  it("T0 absent → natural-language build → approval → T1 discovered → tools/call → extension", async () => {
    const service = new ForgeService(new MemoryStateStore());
    const { server, registry } = await createForgeMcpServer(service);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({
      name: "alexa-simulator-test",
      version: "1.0.0",
    });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      expect(
        (await client.listTools()).tools.map((t) => t.name).slice(0, 2),
      ).toEqual(["forge.build", "forge.inspect"]);
      const built = await client.callTool({
        name: "forge.build",
        arguments: { request: scoutRequest },
      });
      const content = built.content as Array<{ type: string; text?: string }>;
      const release = releaseSchema.parse(JSON.parse(content[0].text!));
      expect(release.report.passed).toBe(true);
      expect(release.definition.toolContract.name).toBe("internship_scout");
      expect(
        (await client.listTools()).tools.some(
          (t) => t.name === "internship_scout",
        ),
      ).toBe(false);
      expect(
        (
          await client.callTool({
            name: "internship_scout",
            arguments: { eventId: "early", jobPosting: postings.amd },
          })
        ).isError,
      ).toBe(true);
      await service.approve(
        release.definition.id,
        release.definition.version,
        release.digest,
      );
      await registry.sync();
      expect(
        (await client.listTools()).tools.some(
          (t) =>
            t.name === "internship_scout" &&
            t.inputSchema.properties?.jobPosting,
        ),
      ).toBe(true);
      const result = await client.callTool({
        name: "internship_scout",
        arguments: { eventId: "mcp-event", jobPosting: postings.amd },
      });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        status: "success",
        version: "1.0.0",
        outcome: { "score-match": { matchScore: 100 } },
      });
      const patch = await service.propose(extensionRequest);
      await service.approve(
        patch.definition.id,
        patch.definition.version,
        patch.digest,
      );
      await registry.sync();
      expect(
        (await client.listTools()).tools.find(
          (t) => t.name === "internship_scout",
        )?.description,
      ).toContain("1.1.0");
      const updated = await client.callTool({
        name: "internship_scout",
        arguments: { eventId: "mcp-letter", jobPosting: postings.amd },
      });
      expect(updated.structuredContent).toMatchObject({
        version: "1.1.0",
        status: "success",
      });
      expect(
        Object.values((await service.store.read()).effects).some(
          (e) => e.kind === "document",
        ),
      ).toBe(true);
      await service.rollback("internship-scout", "1.0.0");
      await registry.sync();
      expect(
        (await client.listTools()).tools.find(
          (t) => t.name === "internship_scout",
        )?.description,
      ).toContain("1.0.0");
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("a fresh MCP server discovers installed state after restart", async () => {
    const service = new ForgeService(new MemoryStateStore());
    const release = await service.propose(scoutRequest);
    await service.approve(
      release.definition.id,
      release.definition.version,
      release.digest,
    );
    const { registry } = await createForgeMcpServer(service);
    expect(registry.listTools().map((t) => t.name)).toEqual([
      "internship_scout",
    ]);
  });
  it("cannot register an unapproved proposal", async () => {
    const service = new ForgeService(new MemoryStateStore());
    const proposal = await service.propose(scoutRequest);
    expect(() =>
      new McpToolRegistry(
        new McpServer({ name: "test", version: "1" }),
        service,
      ).registerTool(proposal),
    ).toThrow(/approved/);
  });
});
