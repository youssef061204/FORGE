import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import {
  parseOpenApi,
  extractOpenApi,
  OpenApiConnector,
} from "../src/forge/product/openapi";
import { ExternalMcpConnector } from "../src/forge/product/external-mcp";
import { GoogleFabricConnector } from "../src/forge/product/builtin";
import { ConnectorFabric } from "../src/forge/product/fabric";
import {
  connectionConfigSchema,
  type CallContext,
} from "../src/forge/product/contracts";
import { assertAllowedUrl } from "../src/forge/product/network";
import {
  stripSchemaMetadata,
  validateJson,
} from "../src/forge/product/schemas";
import { SecretVault } from "../src/forge/vault";
import { GoogleConnection } from "../src/forge/connectors";
import { now } from "./product-fixtures";
afterEach(() => vi.unstubAllEnvs());
const config = () =>
  connectionConfigSchema.parse({
    id: "inventory",
    name: "Test inventory",
    kind: "openapi",
    baseUrl: "https://api.example.com/v1",
    domains: ["api.example.com"],
    operationAllowlist: ["listItems", "updateItem"],
    binding: "test-inventory",
  });
const itemRef = { $ref: "#/components/schemas/Item" };
const jsonContent = (schema: Record<string, unknown>) => ({
  "application/json": { schema },
});
export const spec = {
  openapi: "3.1.0",
  info: { title: "Controlled inventory", version: "1" },
  paths: {
    "/items": {
      get: {
        operationId: "listItems",
        responses: {
          "200": {
            content: jsonContent({
              type: "object",
              properties: { items: { type: "array", items: itemRef } },
              required: ["items"],
              additionalProperties: false,
            }),
          },
        },
      },
    },
    "/items/{id}": {
      patch: {
        operationId: "updateItem",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: { required: true, content: jsonContent(itemRef) },
        responses: { "200": { content: jsonContent(itemRef) } },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          amount: { type: "number", minimum: 0 },
        },
        required: ["id", "description", "amount"],
        additionalProperties: false,
      },
    },
  },
};
describe("connector metadata and broker boundaries", () => {
  it("extracts typed read/write operations and preserves schema properties named description", () => {
    const operations = extractOpenApi(
      parseOpenApi(JSON.stringify(spec)),
      config(),
    );
    expect(
      operations.map((operation) => [
        operation.id,
        operation.kind,
        operation.permission,
      ]),
    ).toEqual([
      ["inventory.listItems", "read", "inventory.listItems.read"],
      ["inventory.updateItem", "write", "inventory.updateItem.write"],
    ]);
    validateJson(
      operations[1].inputSchema,
      { id: "a", body: { id: "a", description: "Item", amount: 3 } },
      "input",
    );
    expect(() =>
      validateJson(
        operations[1].inputSchema,
        { id: "a", body: { id: "a", amount: 3 } },
        "input",
      ),
    ).toThrow(/schema/);
  });
  it("parses bounded YAML and blocks aliases, remote references, and endpoint traversal", () => {
    expect(parseOpenApi("openapi: 3.0.3\npaths: {}\n").openapi).toBe("3.0.3");
    expect(() => parseOpenApi("x: &a [1, 2]\ny: *a")).toThrow();
    expect(() =>
      extractOpenApi(
        { ...spec, paths: { "/../admin": spec.paths["/items"] } },
        config(),
      ),
    ).toThrow(/Unsafe/);
    const remote = structuredClone(spec);
    remote.components.schemas.Item = {
      $ref: "https://evil.example.com/schema",
    } as unknown as typeof remote.components.schemas.Item;
    expect(() => extractOpenApi(remote, config())).toThrow(/Remote/);
  });
  it.each([
    "http://api.example.com",
    "https://user:password@api.example.com",
    "https://127.0.0.1",
    "https://api.example.com:8443",
    "https://api.example.com.evil.test",
  ])("blocks unapproved URL %s", (url) => {
    expect(() =>
      assertAllowedUrl(url, ["api.example.com", "127.0.0.1"]),
    ).toThrow();
  });
  it("invokes only the approved endpoint with vault-only credentials and validates responses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "forge-import-"));
    try {
      const vault = new SecretVault(directory);
      await vault.set("connector:inventory", {
        kind: "bearer",
        token: "TEST-PRIVATE-TOKEN",
      });
      const http = vi
        .fn()
        .mockResolvedValue(
          Response.json({ id: "a", description: "Updated", amount: 2 }),
        );
      const connector = new OpenApiConnector(
        { ...config(), spec },
        vault,
        http,
      );
      expect(JSON.stringify(await connector.describe())).not.toContain(
        "TEST-PRIVATE",
      );
      await connector.invoke(
        "inventory.updateItem",
        { id: "a", body: { id: "a", description: "Updated", amount: 2 } },
        { key: "effect", mode: "live", now, observations: {} },
      );
      expect(String(http.mock.calls[0][0])).toBe(
        "https://api.example.com/v1/items/a",
      );
      expect(
        new Headers(http.mock.calls[0][1].headers).get("Authorization"),
      ).toBe("Bearer TEST-PRIVATE-TOKEN");
      await expect(
        connector.preflight("inventory.updateItem", {
          id: "../admin",
          body: { id: "a", description: "X", amount: 2 },
        }),
      ).rejects.toThrow(/authority/);
      await expect(
        connector.invoke(
          "inventory.updateItem",
          { id: "a", body: { id: "a", description: "Updated", amount: 2 } },
          { key: "effect", mode: "replay", now, observations: {} },
        ),
      ).rejects.toThrow(/Replay/);
      expect(http).toHaveBeenCalledTimes(1);
      http.mockResolvedValueOnce(Response.json({ incorrect: true }));
      await expect(
        connector.invoke(
          "inventory.listItems",
          {},
          { key: "read", mode: "replay", now, observations: {} },
        ),
      ).rejects.toThrow(/schema/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("discovers and invokes actual external MCP tools; server hints do not grant owner read authority", async () => {
    const server = new McpServer({ name: "external-test", version: "1" });
    server.registerTool(
      "read_stock",
      {
        inputSchema: { sku: z.string() },
        outputSchema: { amount: z.number() },
        annotations: { readOnlyHint: true },
      },
      async () => ({
        content: [{ type: "text", text: "stock" }],
        structuredContent: { amount: 4 },
      }),
    );
    const client = new Client({ name: "fabric", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      const base = connectionConfigSchema.parse({
        id: "warehouse",
        name: "Test warehouse",
        kind: "mcp",
        baseUrl: "https://warehouse.example.com/mcp",
        domains: ["warehouse.example.com"],
        operationAllowlist: ["read_stock"],
        binding: "test",
      });
      const connector = new ExternalMcpConnector(
        base,
        new SecretVault(),
        client,
      );
      expect((await connector.describe()).operations[0].kind).toBe("write");
      await expect(
        connector.invoke(
          "warehouse.read_stock",
          { sku: "a" },
          { key: "a", mode: "replay", now, observations: {} },
        ),
      ).rejects.toThrow(/Replay/);
      const owned = new ExternalMcpConnector(
        { ...base, readOperations: ["read_stock"] },
        new SecretVault(),
        client,
      );
      const fabric = new ConnectorFabric();
      fabric.register("warehouse", owned);
      await fabric.discover();
      expect(
        (
          await fabric.invoke(
            "warehouse.read_stock",
            { sku: "a" },
            { key: "a", mode: "replay", now, observations: {} },
          )
        ).data,
      ).toEqual({ amount: 4 });
    } finally {
      await client.close();
      await server.close();
    }
  });
  it("Google timed writes enforce date bounds, current snapshot etags, consent and no invitations", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_ID", "test-dedicated-calendar");
    const request = vi.fn().mockResolvedValue({ id: "event-a" });
    const status = vi.fn().mockResolvedValue({
      configured: true,
      connected: true,
      calendarConfigured: true,
      calendarWriteConsent: true,
      binding: "owner",
    });
    const google = { request, status } as unknown as GoogleConnection;
    const connector = new GoogleFabricConnector("calendar", google);
    const context: CallContext = {
      key: "test-effect",
      mode: "live",
      now,
      observations: {
        calendar: { events: [{ id: "event-a", etag: '"etag-a"' }] },
      },
    };
    const args = {
      eventId: "event-a",
      title: "Controlled prep block",
      start: "2026-10-19T15:00:00.000Z",
      end: "2026-10-19T16:30:00.000Z",
    };
    await connector.preflight("calendar.update", args, context);
    await connector.invoke("calendar.update", args, context);
    expect(request.mock.calls[0][0]).toContain("sendUpdates=none");
    expect(request.mock.calls[0][1].headers["If-Match"]).toBe('"etag-a"');
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
      summary: args.title,
      start: { dateTime: args.start },
      end: { dateTime: args.end },
    });
    await expect(
      connector.preflight(
        "calendar.update",
        { ...args, eventId: "outside-calendar" },
        context,
      ),
    ).rejects.toThrow(/authorized snapshot/);
    await expect(
      connector.preflight(
        "calendar.update",
        { ...args, end: args.start },
        context,
      ),
    ).rejects.toThrow(/window/);
    status.mockResolvedValue({
      ...(await status()),
      calendarWriteConsent: false,
    });
    await expect(
      connector.invoke("calendar.create", args, context),
    ).rejects.toThrow(/consent/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("validates 2020-12 constraints without dropping enum payload or properties named examples", () => {
    const schema = stripSchemaMetadata({
      type: "object",
      properties: {
        examples: { type: "string" },
        data: { const: { description: "keep" } },
      },
      required: ["examples", "data"],
      unevaluatedProperties: false,
    });
    validateJson(
      schema,
      { examples: "a", data: { description: "keep" } },
      "schema",
    );
    expect(() =>
      validateJson(
        schema,
        { examples: "a", data: { description: "remove" } },
        "schema",
      ),
    ).toThrow();
  });
});
