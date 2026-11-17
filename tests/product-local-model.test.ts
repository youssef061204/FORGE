import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalMissionModel,
  localModelEndpoint,
} from "../src/forge/product/local-model";
import type { PlanningContext } from "../src/forge/product/provider";
import type { Solution } from "../src/forge/product/contracts";
import { MemoryStateStore } from "../src/forge/store";
import {
  WorkspaceConnector,
  importWorkspaceDocument,
} from "../src/forge/product/workspace";
import { validateJson } from "../src/forge/product/schemas";

const modelName = "local-test:3b";
const endpoint = "http://127.0.0.1:11435";
const context = (): PlanningContext => ({
  goal: "Transform the available input into a local output file",
  resources: [],
  existing: [],
  conversation: [],
});
const solution = (): Solution => ({
  route: "SYNTHESIZE",
  explanation: "Create a bounded pure transformation",
  existingIds: [],
  missingConnections: [],
  program: {
    name: "Input summary",
    description: "Produce a summary over the supplied input",
    source:
      'function execute(input: ModuleInput): ModuleOutput { return {operations:[],result:{summary:"No changes requested"},state:{}}; }',
    reads: [],
    actions: [],
    trigger: { kind: "manual" },
    tests: ["Empty input", "Boundary input"].map((name) => ({
      name,
      input: {
        now: "2026-10-22T12:00:00.000Z",
        input: {},
        state: {},
        observations: {},
      },
      expectedOperations: [],
      expectedEffects: [],
    })),
  },
});
const envelope = (content: unknown = solution()) => ({
  model: modelName,
  done: true,
  done_reason: "stop",
  message: { role: "assistant", content: JSON.stringify(content) },
  prompt_eval_count: 1276,
  eval_count: 634,
});
const localDetails = () => ({
  details: { format: "gguf" },
  model_info: { "general.architecture": "qwen2" },
});
function transport(
  options: {
    names?: string[];
    details?: unknown;
    chat?: unknown;
    source?: unknown;
    failure?: Error;
  } = {},
) {
  let chatCalls = 0;
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.pathname === "/api/tags")
      return Response.json({
        models: (options.names ?? [modelName]).map((name) => ({ name })),
      });
    if (url.pathname === "/api/show")
      return Response.json(options.details ?? localDetails());
    if (url.pathname === "/api/chat") {
      if (options.failure) throw options.failure;
      chatCalls++;
      return Response.json(
        chatCalls === 1
          ? (options.chat ??
              envelope({
                ...solution(),
                program: {
                  ...solution().program!,
                  source: "Source is generated in the typed second stage.",
                },
              }))
          : (options.source ?? {
              ...envelope(),
              message: {
                role: "assistant",
                content: solution().program!.source,
              },
            }),
      );
    }
    throw new Error("Unexpected local model endpoint: " + url.pathname);
  });
}
function paths(http: ReturnType<typeof transport>) {
  return http.mock.calls.map(([url]) => new URL(String(url)).pathname);
}
function chatBody(http: ReturnType<typeof transport>, index = 0) {
  const call = http.mock.calls.filter(
    ([url]) => new URL(String(url)).pathname === "/api/chat",
  )[index];
  expect(call).toBeDefined();
  return JSON.parse(String(call![1]?.body));
}
afterEach(() => vi.restoreAllMocks());

describe("local model boundary (injected HTTP; no model or cloud requests)", () => {
  it.each([
    "https://127.0.0.1:11435",
    "http://ollama.example.com",
    "http://user:secret@localhost:11435",
    "http://localhost:11435/api",
    "http://localhost:11435/?remote=1",
  ])("rejects an endpoint outside the fixed local transport: %s", (url) => {
    const http = transport();
    expect(() => new LocalMissionModel(modelName, url, http)).toThrow(
      /loopback/,
    );
    expect(http).not.toHaveBeenCalled();
  });

  it.each([
    "qwen:cloud",
    "gpt-oss:120b-cloud",
    "https://provider/model",
    "provider/model",
  ])("rejects cloud or remote model selection %s before requests", (name) => {
    const http = transport();
    expect(() => new LocalMissionModel(name, endpoint, http)).toThrow(
      /remote\/cloud/,
    );
    expect(http).not.toHaveBeenCalled();
  });

  it("accepts only explicit local endpoint origins and never follows redirects", async () => {
    expect(localModelEndpoint(endpoint).hostname).toBe("127.0.0.1");
    const http = transport();
    const model = new LocalMissionModel(modelName, endpoint, http);
    expect(await model.status()).toMatchObject({
      ready: true,
      label: "LOCAL MODEL",
    });
    expect(paths(http)).toEqual(["/api/tags", "/api/show"]);
    for (const [url, init] of http.mock.calls) {
      expect(new URL(String(url)).origin).toBe(endpoint);
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    const show = http.mock.calls[1][1];
    expect(show?.method).toBe("POST");
    expect(JSON.parse(String(show?.body))).toEqual({ model: modelName });
  });

  it("does not chat, show, download or pull a model that is not already installed", async () => {
    const http = transport({ names: ["another-model:3b"] });
    const model = new LocalMissionModel(modelName, endpoint, http);
    await expect(model.plan(context())).rejects.toThrow(
      /not installed.*No download or cloud fallback/,
    );
    expect(paths(http)).toEqual(["/api/tags"]);
  });

  it.each([
    { ...localDetails(), remote_host: "https://provider.example" },
    { ...localDetails(), remote_model: "paid-model" },
    { details: { format: "safetensors" }, model_info: {} },
    { details: { format: "gguf" } },
  ])(
    "blocks unverified local model metadata %j before chat",
    async (details) => {
      const http = transport({ details });
      const model = new LocalMissionModel(modelName, endpoint, http);
      await expect(model.plan(context())).rejects.toThrow(
        /verified local GGUF/,
      );
      expect(paths(http)).toEqual(["/api/tags", "/api/show"]);
    },
  );

  it("validates structured output and records the provider's actual response token counts", async () => {
    const http = transport();
    const result = await new LocalMissionModel(modelName, endpoint, http).plan(
      context(),
    );
    expect(result.solution).toEqual(solution());
    expect(result.usage).toMatchObject({
      provider: "ollama-local",
      model: modelName,
      region: null,
      inputTokens: 2552,
      outputTokens: 1268,
      schemaValidated: true,
      calls: 2,
      tokensComplete: true,
    });
    expect(result.usage.durationMs).toBeGreaterThanOrEqual(0);
    expect(paths(http)).toEqual([
      "/api/tags",
      "/api/show",
      "/api/chat",
      "/api/chat",
    ]);
    const body = chatBody(http);
    expect(body).toMatchObject({ model: modelName, stream: false });
    expect(
      body.format.anyOf.map(
        (branch: { properties: { route: { enum: string[] } } }) =>
          branch.properties.route.enum[0],
      ),
    ).toEqual(["SYNTHESIZE", "CONNECT", "CLARIFY"]);
    expect(body.messages[1].content).toBe(
      JSON.stringify({ ...context(), observationBindings: [] }),
    );
    const source = chatBody(http, 1);
    expect(source.format).toBeUndefined();
    expect(source.messages[0].content).toContain("type ModuleInput =");
    expect(source.messages[0].content).toContain(
      'const operations: ModuleOutput["operations"] = []',
    );
    expect(JSON.parse(source.messages[1].content).contract).toMatchObject({
      reads: [],
      actions: [],
      tests: solution().program!.tests,
    });
    expect(JSON.parse(source.messages[1].content).program).toBeUndefined();
  });

  it("only offers installed-program routes when enough retrieved tools exist", async () => {
    const tool = (id: string): PlanningContext["existing"][number] => ({
      id,
      name: id,
      description: "An installed program",
      goal: "Existing task",
      version: "1.0.0",
      source: solution().program!.source,
      reads: [],
      actions: [],
      trigger: { kind: "manual" },
    });
    for (const count of [1, 2]) {
      const http = transport();
      const input = {
        ...context(),
        existing: Array.from({ length: count }, (_, index) =>
          tool("tool-" + index),
        ),
      };
      await new LocalMissionModel(modelName, endpoint, http).plan(input);
      const routes = chatBody(http).format.anyOf.map(
        (branch: { properties: { route: { enum: string[] } } }) =>
          branch.properties.route.enum[0],
      );
      expect(routes).toContain("REUSE");
      expect(routes).toContain("EXTEND");
      expect(routes.includes("COMPOSE")).toBe(count > 1);
    }
  });

  it("constrains plan reads, actions and semantic effects to exact connected operation schemas", async () => {
    const resource = (
      id: string,
      status: PlanningContext["resources"][number]["status"],
    ): PlanningContext["resources"][number] => ({
      id,
      name: id,
      kind: "builtin",
      status,
      mode: "test",
      binding: id,
      setup: "/inspect",
      constraints: {},
      operations: (["read", "write"] as const).map((kind) => ({
        id: `${id}.${kind}`,
        connector: id,
        kind,
        name: kind,
        description: kind,
        permission: `${id}.${kind}`,
        sideEffect: kind === "read" ? "none" : "reversible",
        idempotent: true,
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
        outputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      })),
    });
    const connected = resource("available", "connected");
    const http = transport();
    const input = {
      ...context(),
      resources: [connected, resource("locked", "needs_consent")],
    };
    await new LocalMissionModel(modelName, endpoint, http).plan(input);
    const program = chatBody(http).format.anyOf[0].properties.program;
    expect(
      program.properties.reads.items.anyOf.map(
        (item: { properties: { operation: { const: string } } }) =>
          item.properties.operation.const,
      ),
    ).toEqual(["available.read"]);
    expect(
      program.properties.reads.items.anyOf[0].properties.arguments,
    ).toEqual(connected.operations[0].inputSchema);
    expect(program.properties.reads.items.anyOf[0].properties.ref).toEqual({
      type: "string",
      const: "r0",
    });
    expect(
      JSON.parse(chatBody(http).messages[1].content).observationBindings,
    ).toEqual([{ operation: "available.read", ref: "r0" }]);
    expect(program.properties.actions.items.enum).toEqual(["available.write"]);
    const tests = program.properties.tests;
    expect(tests.maxItems).toBe(2);
    expect(tests.items.required).toContain("expectedEffects");
    expect(tests.items.properties.expectedOutput).toBeUndefined();
    expect(tests.items.properties.expectedOperations.items.enum).toEqual([
      "available.write",
    ]);
    const effect = tests.items.properties.expectedEffects.items.anyOf[0];
    expect(effect.properties.operation.const).toBe("available.write");
    expect(effect.properties.arguments).toEqual(
      connected.operations[1].inputSchema,
    );
    expect(
      JSON.parse(chatBody(http).messages[1].content).resources[1].operations,
    ).toEqual([]);
  });

  it("treats an explicit edit target as route and identity constraints while keeping implicit context general", async () => {
    const existing = ["other-tool", "selected-tool"].map((id) => ({
      id,
      name: id,
      description: "An installed tool",
      goal: "An earlier task",
      version: "1.0.0",
      source: solution().program!.source,
      reads: [],
      actions: [],
      trigger: { kind: "manual" as const },
    }));
    const http = transport({
      chat: envelope({
        ...solution(),
        route: "EXTEND",
        existingIds: ["selected-tool"],
      }),
    });
    const result = await new LocalMissionModel(modelName, endpoint, http).plan({
      ...context(),
      existing,
      editTargetId: "selected-tool",
      followUpId: "other-tool",
    });
    expect(result.solution.route).toBe("EXTEND");
    const branches = chatBody(http).format.anyOf;
    expect(
      branches.map(
        (branch: { properties: { route: { enum: string[] } } }) =>
          branch.properties.route.enum[0],
      ),
    ).toEqual(["EXTEND", "CONNECT", "CLARIFY"]);
    expect(branches[0].properties.existingIds).toMatchObject({
      minItems: 1,
      maxItems: 1,
      items: { enum: ["selected-tool"] },
    });
    for (const branch of branches.slice(1)) {
      expect(branch.properties.existingIds.maxItems).toBe(0);
      expect(branch.properties.program).toBeUndefined();
    }
    expect(JSON.parse(chatBody(http).messages[1].content).editTargetId).toBe(
      "selected-tool",
    );

    const implicit = transport();
    await new LocalMissionModel(modelName, endpoint, implicit).plan({
      ...context(),
      existing,
      followUpId: "selected-tool",
    });
    expect(
      chatBody(implicit).format.anyOf.map(
        (branch: { properties: { route: { enum: string[] } } }) =>
          branch.properties.route.enum[0],
      ),
    ).toEqual([
      "SYNTHESIZE",
      "CONNECT",
      "CLARIFY",
      "REUSE",
      "EXTEND",
      "COMPOSE",
    ]);
  });

  it("rejects an unavailable explicit edit target before transport", async () => {
    const http = transport();
    await expect(
      new LocalMissionModel(modelName, endpoint, http).plan({
        ...context(),
        editTargetId: "missing-tool",
      }),
    ).rejects.toThrow(/edit target is unavailable/);
    expect(http).not.toHaveBeenCalled();
  });

  it.each([
    { route: "SYNTHESIZE", existingIds: [] },
    { route: "EXTEND", existingIds: ["other-tool"] },
  ])(
    "rejects output that ignores explicit edit constraints before source generation: %j",
    async (fields) => {
      const existing = ["other-tool", "selected-tool"].map((id) => ({
        id,
        name: id,
        description: "An installed tool",
        goal: "An earlier task",
        version: "1.0.0",
        source: solution().program!.source,
        reads: [],
        actions: [],
        trigger: { kind: "manual" as const },
      }));
      const http = transport({ chat: envelope({ ...solution(), ...fields }) });
      await expect(
        new LocalMissionModel(modelName, endpoint, http).plan({
          ...context(),
          existing,
          editTargetId: "selected-tool",
        }),
      ).rejects.toThrow(/route|exact selected tool/);
      expect(paths(http)).toEqual(["/api/tags", "/api/show", "/api/chat"]);
    },
  );

  it("gives each read its own canonical ref and a bounded exact synthetic response contract", async () => {
    const store = new MemoryStateStore();
    await importWorkspaceDocument(store, {
      name: "table.csv",
      format: "csv",
      text: "a,b,c,d\none,two,three,four\n",
    });
    await importWorkspaceDocument(store, {
      name: "note.txt",
      format: "text",
      text: "A short note",
    });
    const descriptor = await new WorkspaceConnector(store).describe();
    const original = structuredClone(descriptor);
    const http = transport();
    await new LocalMissionModel(modelName, endpoint, http).plan({
      ...context(),
      resources: [descriptor],
    });
    const plan = chatBody(http).format.anyOf[0].properties.program;
    expect(
      plan.properties.reads.items.anyOf.map(
        (branch: {
          properties: { operation: { const: string }; ref: { const: string } };
        }) => ({
          operation: branch.properties.operation.const,
          ref: branch.properties.ref.const,
        }),
      ),
    ).toEqual([
      { operation: descriptor.operations[0].id, ref: "r0" },
      { operation: descriptor.operations[1].id, ref: "r1" },
    ]);
    const inputSchema = plan.properties.tests.items.properties.input;
    const observations = inputSchema.properties.observations;
    expect(Object.keys(observations.properties)).toEqual(["r0", "r1"]);
    expect(observations.additionalProperties).toBe(false);
    const csv = observations.properties.r0;
    expect(csv.required).toEqual(["id", "name", "format", "columns", "rows"]);
    expect(csv.additionalProperties).toBe(false);
    expect(csv.properties.id.const).toBe(
      (
        descriptor.operations[0].outputSchema.properties as Record<
          string,
          { const: string }
        >
      ).id.const,
    );
    expect(csv.properties.format.const).toBe("csv");
    expect(csv.properties.columns).toMatchObject({
      minItems: 4,
      maxItems: 4,
      uniqueItems: true,
      items: { enum: ["a", "b", "c", "d"] },
    });
    expect(csv.properties.rows.maxItems).toBe(3);
    expect(csv.properties.rows.items.properties.a).toEqual({
      type: "string",
      maxLength: 256,
    });
    expect(observations.properties.r1.properties.text.maxLength).toBe(256);
    const fixture = {
      id: csv.properties.id.const,
      name: "synthetic.csv",
      format: "csv",
      columns: ["a", "b", "c", "d"],
      rows: [{ a: "1", b: "2", c: "3", d: "4" }],
    };
    const testInput = {
      now: "2026-10-23T04:00:00.000Z",
      input: {},
      state: {},
      observations: { r0: fixture },
    };
    expect(() => validateJson(inputSchema, testInput, "fixture")).not.toThrow();
    expect(() =>
      validateJson(
        inputSchema,
        { ...testInput, observations: { file: fixture } },
        "fixture",
      ),
    ).toThrow(/additional properties/);
    expect(() =>
      validateJson(
        inputSchema,
        {
          ...testInput,
          observations: {
            r0: { ...fixture, rows: [{ a: 1, b: "2", c: "3", d: "4" }] },
          },
        },
        "fixture",
      ),
    ).toThrow(/must be string/);
    expect(() =>
      validateJson(
        inputSchema,
        { ...testInput, observations: { r0: { ...fixture, id: "invented" } } },
        "fixture",
      ),
    ).toThrow(/constant/);
    expect(() =>
      validateJson(
        inputSchema,
        {
          ...testInput,
          observations: {
            r0: { ...fixture, rows: Array(4).fill(fixture.rows[0]) },
          },
        },
        "fixture",
      ),
    ).toThrow(/more than 3/);
    expect(descriptor).toEqual(original);
  });

  it("rejects a model response choosing COMPOSE when no installed programs exist", async () => {
    const http = transport({
      chat: envelope({
        ...solution(),
        route: "COMPOSE",
        existingIds: ["missing-a", "missing-b"],
      }),
    });
    await expect(
      new LocalMissionModel(modelName, endpoint, http).plan(context()),
    ).rejects.toThrow(/route|COMPOSE|existing|installed/i);
    expect(paths(http)).toEqual(["/api/tags", "/api/show", "/api/chat"]);
  });

  it.each([
    { route: "CONNECT", missingConnections: ["Calendar"], question: undefined },
    {
      route: "CLARIFY",
      missingConnections: [],
      question: "Which file should I use?",
    },
  ])("does not generate source for $route", async (fields) => {
    const http = transport({
      chat: envelope({ ...solution(), ...fields, program: undefined }),
    });
    const result = await new LocalMissionModel(modelName, endpoint, http).plan(
      context(),
    );
    expect(result.solution.route).toBe(fields.route);
    expect(result.usage.calls).toBe(1);
    expect(paths(http)).toEqual(["/api/tags", "/api/show", "/api/chat"]);
  });

  it.each([
    { done: false },
    { done_reason: "length" },
    { model: "different-model:3b" },
    { message: { content: "const renamed = () => {};" } },
    {
      message: {
        content:
          '{"source":"function execute(input: ModuleInput): ModuleOutput {}"}',
      },
    },
  ])(
    "preserves incomplete or rejected typed-source diagnostics without installing it: %j",
    async (invalid) => {
      const source = {
        ...envelope(),
        message: { role: "assistant", content: solution().program!.source },
        ...invalid,
      };
      const http = transport({ source });
      const error = await new LocalMissionModel(modelName, endpoint, http)
        .plan(context())
        .catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        usage: {
          calls: 2,
          inputTokens: 2552,
          outputTokens: 1268,
          schemaValidated: false,
          tokensComplete: true,
        },
        modelFailure: {
          stage: "source",
          content: source.message.content,
          doneReason: source.done_reason,
        },
      });
      expect(paths(http)).toEqual([
        "/api/tags",
        "/api/show",
        "/api/chat",
        "/api/chat",
      ]);
    },
  );

  it("counts an interrupted source request and marks unknown token totals incomplete", async () => {
    const http = transport();
    const fallback = http.getMockImplementation()!;
    let chats = 0;
    http.mockImplementation(async (input, init) => {
      if (new URL(String(input)).pathname === "/api/chat" && ++chats === 2)
        throw new DOMException("Interrupted source", "TimeoutError");
      return fallback(input, init);
    });
    const error = await new LocalMissionModel(modelName, endpoint, http)
      .plan(context())
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      usage: {
        calls: 2,
        inputTokens: 1276,
        outputTokens: 634,
        tokensComplete: false,
        schemaValidated: false,
      },
      modelFailure: { stage: "source", content: "" },
    });
    expect(paths(http)).toEqual([
      "/api/tags",
      "/api/show",
      "/api/chat",
      "/api/chat",
    ]);
  });

  it.each([
    envelope({ ...solution(), route: "UNKNOWN" }),
    envelope({ ...solution(), program: { ...solution().program!, tests: [] } }),
    { ...envelope(), message: { role: "assistant", content: "not JSON" } },
    { ...envelope(), done: false },
    { ...envelope(), done_reason: "length" },
    { ...envelope(), model: "different-model:3b" },
  ])(
    "rejects malformed, incomplete or wrong-model output without fallback",
    async (chat) => {
      const http = transport({ chat });
      await expect(
        new LocalMissionModel(modelName, endpoint, http).plan(context()),
      ).rejects.toThrow();
      expect(paths(http)).toEqual(["/api/tags", "/api/show", "/api/chat"]);
    },
  );

  it("propagates timeouts with no hosted fallback and permits a later explicit retry", async () => {
    const failure = new DOMException(
      "Local inference timed out",
      "TimeoutError",
    );
    const http = transport({ failure });
    const model = new LocalMissionModel(modelName, endpoint, http);
    await expect(model.plan(context())).rejects.toBe(failure);
    await expect(model.plan(context())).rejects.toBe(failure);
    expect(paths(http)).toEqual([
      "/api/tags",
      "/api/show",
      "/api/chat",
      "/api/tags",
      "/api/show",
      "/api/chat",
    ]);
  });

  it("treats redirect/HTTP failures as failures rather than trying another provider", async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://paid.example" },
      }),
    );
    await expect(
      new LocalMissionModel(modelName, endpoint, http).plan(context()),
    ).rejects.toThrow(/HTTP 302.*no remote fallback/);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0][1]?.redirect).toBe("error");
  });
});
