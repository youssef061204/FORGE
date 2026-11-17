import { afterEach, describe, expect, it, vi } from "vitest";
const guards = vi.hoisted(() => ({ clients: vi.fn(), credentials: vi.fn() }));
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    constructor() {
      guards.clients();
    }
  },
  ConverseCommand: class {},
}));
vi.mock("@aws-sdk/credential-providers", () => ({
  fromNodeProviderChain: guards.credentials,
}));
import {
  BedrockStructuredTransport,
  LocalStructuredTransport,
  type GenerationRequest,
} from "../src/forge/product/model-transport";

const request: GenerationRequest = {
  stage: "plan",
  system: "Return structured data",
  context: { objective: "Example" },
  schema: { type: "object" },
  maxTokens: 100,
};
function localHttp(options: { remote?: boolean; truncated?: boolean } = {}) {
  return vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/tags")
      return Response.json({ models: [{ name: "qwen2.5:7b-instruct" }] });
    if (path === "/api/show")
      return Response.json({
        model_info: {},
        details: { format: "gguf" },
        ...(options.remote ? { remote_host: "remote.test" } : {}),
      });
    expect(path).toBe("/api/chat");
    expect(init?.redirect).toBe("error");
    return Response.json({
      model: "qwen2.5:7b-instruct",
      done: true,
      done_reason: options.truncated ? "length" : "stop",
      message: { content: '{"answer":1}' },
      prompt_eval_count: 17,
      eval_count: 4,
    });
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("provider transport boundaries", () => {
  it("blocks paid construction before credential resolution or SDK client creation", () => {
    vi.stubEnv("FORGE_FREE_ONLY", "true");
    expect(() => new BedrockStructuredTransport()).toThrow(/blocked|disabled/i);
    expect(guards.clients).not.toHaveBeenCalled();
    expect(guards.credentials).not.toHaveBeenCalled();
  });
  it("uses cached loopback weights and accounts the actual request", async () => {
    const http = localHttp();
    const result = await new LocalStructuredTransport(
      undefined,
      undefined,
      http,
    ).generate(request);
    expect(result.text).toBe('{"answer":1}');
    expect(result.usage).toMatchObject({
      provider: "ollama-local",
      calls: 1,
      inputTokens: 17,
      outputTokens: 4,
      tokensComplete: true,
      schemaValidated: false,
    });
    const sent = JSON.parse(
      String(
        http.mock.calls.find(
          ([url]) => new URL(String(url)).pathname === "/api/chat",
        )?.[1]?.body,
      ),
    );
    expect(sent.options.num_predict).toBe(100);
    expect(sent.format).toEqual(request.schema);
  });
  it("rejects remote-backed weights before a generation dispatch", async () => {
    const http = localHttp({ remote: true });
    await expect(
      new LocalStructuredTransport(undefined, undefined, http).generate(
        request,
      ),
    ).rejects.toThrow(/installed model|unavailable|cached/i);
    expect(
      http.mock.calls.some(
        ([url]) => new URL(String(url)).pathname === "/api/chat",
      ),
    ).toBe(false);
  });
  it("retains truncated-call usage and never promotes incomplete source", async () => {
    await expect(
      new LocalStructuredTransport(
        undefined,
        undefined,
        localHttp({ truncated: true }),
      ).generate(request),
    ).rejects.toMatchObject({
      usage: { calls: 1, inputTokens: 17 },
      modelFailure: { doneReason: "length" },
    });
  });
  it("refuses remote URLs and unbounded output before calling any service", async () => {
    expect(
      () => new LocalStructuredTransport(undefined, "https://remote.test"),
    ).toThrow(/loopback/i);
    const http = localHttp();
    await expect(
      new LocalStructuredTransport(undefined, undefined, http).generate({
        ...request,
        maxTokens: 100000,
      }),
    ).rejects.toThrow(/bounded/i);
    expect(http).not.toHaveBeenCalled();
  });
  it("counts a failed dispatched request without inventing token usage", async () => {
    const successful = localHttp();
    const http: typeof fetch = async (url, init) =>
      new URL(String(url)).pathname === "/api/chat"
        ? new Response("Service unavailable", { status: 503 })
        : successful(url, init);
    await expect(
      new LocalStructuredTransport(undefined, undefined, http).generate(
        request,
      ),
    ).rejects.toMatchObject({
      usage: { calls: 1, tokensComplete: false, inputTokens: 0 },
    });
  });
});
